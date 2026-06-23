import csv
from datetime import date as date_cls, timedelta
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import F, Q, Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from .models import Article, Categorie, Entrepot, Lot, Mouvement, Placement, Stock, Ticket
from .serializers import (
    ArticleSerializer, CategorieSerializer, EntrepotSerializer,
    LotSerializer, MouvementSerializer, PlacementSerializer,
    StockSerializer, TicketSerializer,
)


class StoragePagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 200


class IsStorageUser(BasePermission):
    """Allow staff/superusers and members of the 'Storage' group only."""

    message = "Vous n'avez pas accès au module Stockage."

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user and user.is_authenticated and (
                user.is_staff or user.is_superuser or
                user.groups.filter(name='Storage').exists()
            )
        )


def _expire_lots():
    """Flip 'actif' lots whose expiration date has passed to 'perime'. Returns count updated."""
    return Lot.objects.filter(statut='actif', date_peremption__lt=timezone.now().date()).update(statut='perime')


def _read_csv_dataframe(file):
    import pandas as pd
    try:
        return pd.read_csv(file, encoding='utf-8-sig', dtype=str).fillna('')
    except Exception:
        try:
            file.seek(0)
            return pd.read_csv(file, encoding='latin-1', dtype=str).fillna('')
        except Exception as e:
            raise ValueError(f"Impossible de lire le fichier CSV: {e}")


# ─── Catégorie ────────────────────────────────────────────────────────────────

class CategorieViewSet(viewsets.ModelViewSet):
    permission_classes = [IsStorageUser]
    serializer_class   = CategorieSerializer
    pagination_class   = StoragePagination
    filter_backends    = [filters.OrderingFilter]
    ordering           = ['nom']

    def get_queryset(self):
        qs = Categorie.objects.select_related('parent').prefetch_related('articles')
        search = self.request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(Q(code_categorie__icontains=search) | Q(nom__icontains=search))
        return qs


# ─── Article ──────────────────────────────────────────────────────────────────

class ArticleViewSet(viewsets.ModelViewSet):
    permission_classes = [IsStorageUser]
    serializer_class   = ArticleSerializer
    pagination_class   = StoragePagination
    filter_backends    = [filters.OrderingFilter]
    ordering           = ['code_article']

    def get_queryset(self):
        qs = Article.objects.select_related('categorie').prefetch_related('stocks')
        search = self.request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(code_article__icontains=search) | Q(nom__icontains=search) |
                Q(code_barre__icontains=search) | Q(qr_code__icontains=search)
            )
        categorie = self.request.query_params.get('categorie')
        if categorie:
            qs = qs.filter(categorie_id=categorie)
        actif = self.request.query_params.get('actif')
        if actif is not None:
            qs = qs.filter(actif=actif.lower() in ('1', 'true', 'oui'))
        if self.request.query_params.get('alerte_stock'):
            ids = [a.id for a in qs if (
                (a.stocks.aggregate(t=Sum('quantite_disponible'))['t'] or Decimal('0'))
                <= a.seuil_alerte
            )]
            qs = qs.filter(id__in=ids)
        return qs

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.mouvements.exists() or instance.stocks.exists() or instance.lots.exists():
            return Response(
                {'error': "Cet article a un historique de mouvements, lots ou stock — désactivez-le (Actif = non) au lieu de le supprimer."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['get'], url_path='search')
    def search_light(self, request):
        q = request.query_params.get('q', '').strip()
        if not q:
            return Response([])
        qs = Article.objects.filter(
            Q(code_article__icontains=q) | Q(nom__icontains=q) |
            Q(code_barre__icontains=q) | Q(qr_code__icontains=q),
            actif=True,
        ).values('id', 'code_article', 'nom', 'unite_mesure', 'duree_vie_jours')[:20]
        return Response(list(qs))

    @action(detail=False, methods=['get'], url_path='export')
    def export_csv(self, request):
        qs = self.get_queryset()
        filename = f"articles_{date_cls.today():%Y-%m-%d}.csv"
        response = HttpResponse(content_type='text/csv; charset=utf-8-sig')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        writer = csv.writer(response)
        writer.writerow([
            'code_article', 'nom', 'description', 'categorie_code', 'unite_mesure',
            'prix_unitaire', 'duree_vie_jours', 'seuil_alerte', 'qr_code', 'code_barre', 'actif',
        ])
        for a in qs:
            writer.writerow([
                a.code_article, a.nom, a.description,
                a.categorie.code_categorie if a.categorie else '',
                a.unite_mesure, a.prix_unitaire, a.duree_vie_jours or '', a.seuil_alerte,
                a.qr_code or '', a.code_barre or '', 'oui' if a.actif else 'non',
            ])
        return response

    @action(detail=False, methods=['post'], url_path='import')
    def import_csv(self, request):
        if 'file' not in request.FILES:
            return Response({'error': 'Aucun fichier fourni.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            df = _read_csv_dataframe(request.FILES['file'])
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        required = {'code_article', 'nom'}
        missing = required - set(df.columns)
        if missing:
            return Response({'error': f'Colonnes manquantes: {", ".join(missing)}'}, status=status.HTTP_400_BAD_REQUEST)

        success, errors = 0, []
        for i, row in df.iterrows():
            try:
                code = row['code_article'].strip()
                if not code:
                    raise ValueError("code_article vide")
                categorie = None
                cat_code = row.get('categorie_code', '').strip()
                if cat_code:
                    categorie = Categorie.objects.filter(code_categorie=cat_code).first()
                    if categorie is None:
                        raise ValueError(f"Catégorie inconnue: {cat_code}")
                Article.objects.update_or_create(
                    code_article=code,
                    defaults={
                        'nom': row.get('nom', '').strip() or code,
                        'description': row.get('description', ''),
                        'categorie': categorie,
                        'unite_mesure': row.get('unite_mesure', '').strip() or 'pcs',
                        'prix_unitaire': row.get('prix_unitaire') or 0,
                        'duree_vie_jours': int(float(row['duree_vie_jours'])) if row.get('duree_vie_jours') else None,
                        'seuil_alerte': int(float(row['seuil_alerte'])) if row.get('seuil_alerte') else 0,
                        'qr_code': row.get('qr_code', '').strip() or None,
                        'code_barre': row.get('code_barre', '').strip() or None,
                        'actif': row.get('actif', 'oui').strip().lower() not in ('non', 'false', '0'),
                    },
                )
                success += 1
            except Exception as e:
                errors.append({'row': int(i) + 2, 'message': str(e)})

        return Response({'success': success, 'total': len(df), 'errors': errors})


# ─── Entrepôt ────────────────────────────────────────────────────────────────

class EntrepotViewSet(viewsets.ModelViewSet):
    permission_classes = [IsStorageUser]
    serializer_class   = EntrepotSerializer
    pagination_class   = StoragePagination
    filter_backends    = [filters.OrderingFilter]
    ordering           = ['nom']

    def get_queryset(self):
        qs = Entrepot.objects.prefetch_related('placements')
        search = self.request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(Q(code_entrepot__icontains=search) | Q(nom__icontains=search) | Q(ville__icontains=search))
        statut = self.request.query_params.get('statut')
        if statut:
            qs = qs.filter(statut=statut)
        return qs

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if Stock.objects.filter(placement__entrepot=instance, quantite_disponible__gt=0).exists():
            return Response(
                {'error': "Cet entrepôt contient du stock — videz-le avant de le supprimer."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if Mouvement.objects.filter(
            Q(placement_source__entrepot=instance) | Q(placement_destination__entrepot=instance)
        ).exists():
            return Response(
                {'error': "Cet entrepôt a un historique de mouvements — passez-le en statut « Inactif » au lieu de le supprimer."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['get'], url_path='export')
    def export_csv(self, request):
        qs = self.get_queryset()
        filename = f"entrepots_{date_cls.today():%Y-%m-%d}.csv"
        response = HttpResponse(content_type='text/csv; charset=utf-8-sig')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        writer = csv.writer(response)
        writer.writerow(['code_entrepot', 'nom', 'adresse', 'ville', 'responsable', 'capacite_max', 'statut'])
        for e in qs:
            writer.writerow([
                e.code_entrepot, e.nom, e.adresse, e.ville, e.responsable,
                e.capacite_max or '', e.statut,
            ])
        return response

    @action(detail=False, methods=['post'], url_path='import')
    def import_csv(self, request):
        if 'file' not in request.FILES:
            return Response({'error': 'Aucun fichier fourni.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            df = _read_csv_dataframe(request.FILES['file'])
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        required = {'code_entrepot', 'nom'}
        missing = required - set(df.columns)
        if missing:
            return Response({'error': f'Colonnes manquantes: {", ".join(missing)}'}, status=status.HTTP_400_BAD_REQUEST)

        valid_statuts = {c[0] for c in Entrepot._meta.get_field('statut').choices}
        success, errors = 0, []
        for i, row in df.iterrows():
            try:
                code = row['code_entrepot'].strip()
                if not code:
                    raise ValueError("code_entrepot vide")
                statut = row.get('statut', '').strip().lower() or 'actif'
                if statut not in valid_statuts:
                    raise ValueError(f"statut invalide: {statut}")
                Entrepot.objects.update_or_create(
                    code_entrepot=code,
                    defaults={
                        'nom': row.get('nom', '').strip() or code,
                        'adresse': row.get('adresse', ''),
                        'ville': row.get('ville', '').strip(),
                        'responsable': row.get('responsable', '').strip(),
                        'capacite_max': int(float(row['capacite_max'])) if row.get('capacite_max') else None,
                        'statut': statut,
                    },
                )
                success += 1
            except Exception as e:
                errors.append({'row': int(i) + 2, 'message': str(e)})

        return Response({'success': success, 'total': len(df), 'errors': errors})


# ─── Placement ────────────────────────────────────────────────────────────────

class PlacementViewSet(viewsets.ModelViewSet):
    permission_classes = [IsStorageUser]
    serializer_class   = PlacementSerializer
    pagination_class   = StoragePagination
    filter_backends    = [filters.OrderingFilter]
    ordering           = ['entrepot', 'code_emplacement']

    def get_queryset(self):
        qs = Placement.objects.select_related('entrepot')
        search = self.request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(Q(code_emplacement__icontains=search) | Q(zone__icontains=search) | Q(qr_code__icontains=search))
        entrepot = self.request.query_params.get('entrepot')
        if entrepot:
            qs = qs.filter(entrepot_id=entrepot)
        statut = self.request.query_params.get('statut')
        if statut:
            qs = qs.filter(statut=statut)
        return qs

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.stocks.filter(quantite_disponible__gt=0).exists():
            return Response(
                {'error': "Cet emplacement contient du stock — videz-le avant de le supprimer."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if instance.mouvements_source.exists() or instance.mouvements_destination.exists():
            return Response(
                {'error': "Cet emplacement a un historique de mouvements — utilisez le statut « Bloqué » au lieu de le supprimer."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['get'], url_path='search')
    def search_light(self, request):
        q = request.query_params.get('q', '').strip()
        entrepot = request.query_params.get('entrepot')
        qs = Placement.objects.select_related('entrepot')
        if q:
            qs = qs.filter(Q(code_emplacement__icontains=q) | Q(zone__icontains=q) | Q(qr_code__icontains=q))
        if entrepot:
            qs = qs.filter(entrepot_id=entrepot)
        data = [
            {'id': p.id, 'code_emplacement': p.code_emplacement,
             'entrepotCode': p.entrepot.code_entrepot, 'entrepotNom': p.entrepot.nom}
            for p in qs[:20]
        ]
        return Response(data)

    @action(detail=False, methods=['get'], url_path='export')
    def export_csv(self, request):
        qs = self.get_queryset()
        filename = f"placements_{date_cls.today():%Y-%m-%d}.csv"
        response = HttpResponse(content_type='text/csv; charset=utf-8-sig')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        writer = csv.writer(response)
        writer.writerow(['entrepot_code', 'code_emplacement', 'zone', 'allee', 'niveau', 'capacite_max', 'statut', 'qr_code'])
        for p in qs:
            writer.writerow([
                p.entrepot.code_entrepot, p.code_emplacement, p.zone, p.allee, p.niveau,
                p.capacite_max or '', p.statut, p.qr_code or '',
            ])
        return response

    @action(detail=False, methods=['post'], url_path='import')
    def import_csv(self, request):
        if 'file' not in request.FILES:
            return Response({'error': 'Aucun fichier fourni.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            df = _read_csv_dataframe(request.FILES['file'])
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        required = {'entrepot_code', 'code_emplacement'}
        missing = required - set(df.columns)
        if missing:
            return Response({'error': f'Colonnes manquantes: {", ".join(missing)}'}, status=status.HTTP_400_BAD_REQUEST)

        valid_statuts = {c[0] for c in Placement._meta.get_field('statut').choices}
        success, errors = 0, []
        for i, row in df.iterrows():
            try:
                ent_code = row['entrepot_code'].strip()
                code = row['code_emplacement'].strip()
                if not ent_code or not code:
                    raise ValueError("entrepot_code et code_emplacement requis")
                entrepot = Entrepot.objects.filter(code_entrepot=ent_code).first()
                if entrepot is None:
                    raise ValueError(f"Entrepôt inconnu: {ent_code}")
                statut = row.get('statut', '').strip().lower() or 'disponible'
                if statut not in valid_statuts:
                    raise ValueError(f"statut invalide: {statut}")
                Placement.objects.update_or_create(
                    entrepot=entrepot, code_emplacement=code,
                    defaults={
                        'zone': row.get('zone', '').strip(),
                        'allee': row.get('allee', '').strip(),
                        'niveau': row.get('niveau', '').strip(),
                        'capacite_max': int(float(row['capacite_max'])) if row.get('capacite_max') else None,
                        'statut': statut,
                        'qr_code': row.get('qr_code', '').strip() or None,
                    },
                )
                success += 1
            except Exception as e:
                errors.append({'row': int(i) + 2, 'message': str(e)})

        return Response({'success': success, 'total': len(df), 'errors': errors})


# ─── Lot ──────────────────────────────────────────────────────────────────────

class LotViewSet(viewsets.ModelViewSet):
    permission_classes = [IsStorageUser]
    serializer_class   = LotSerializer
    pagination_class   = StoragePagination
    filter_backends    = [filters.OrderingFilter]
    ordering           = ['date_peremption']

    def get_queryset(self):
        _expire_lots()
        qs = Lot.objects.select_related('article')
        search = self.request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(Q(numero_lot__icontains=search) | Q(article__code_article__icontains=search) | Q(qr_code__icontains=search))
        article = self.request.query_params.get('article')
        if article:
            qs = qs.filter(article_id=article)
        statut = self.request.query_params.get('statut')
        if statut:
            qs = qs.filter(statut=statut)
        if self.request.query_params.get('expiration_proche'):
            horizon = timezone.now().date() + timedelta(days=30)
            qs = qs.filter(date_peremption__lte=horizon, statut='actif')
        return qs

    @action(detail=False, methods=['get'], url_path='search')
    def search_light(self, request):
        _expire_lots()
        q = request.query_params.get('q', '').strip()
        article = request.query_params.get('article')
        today = timezone.now().date()
        qs = Lot.objects.select_related('article').filter(statut='actif').filter(
            Q(date_peremption__isnull=True) | Q(date_peremption__gte=today)
        )
        if q:
            qs = qs.filter(Q(numero_lot__icontains=q))
        if article:
            qs = qs.filter(article_id=article)
        data = [
            {'id': lot.id, 'numero_lot': lot.numero_lot,
             'date_peremption': str(lot.date_peremption) if lot.date_peremption else None}
            for lot in qs[:20]
        ]
        return Response(data)

    @action(detail=False, methods=['get'], url_path='export')
    def export_csv(self, request):
        qs = self.get_queryset()
        filename = f"lots_{date_cls.today():%Y-%m-%d}.csv"
        response = HttpResponse(content_type='text/csv; charset=utf-8-sig')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        writer = csv.writer(response)
        writer.writerow(['article_code', 'numero_lot', 'date_fabrication', 'date_peremption', 'quantite_initiale', 'statut', 'qr_code'])
        for lot in qs:
            writer.writerow([
                lot.article.code_article, lot.numero_lot,
                lot.date_fabrication or '', lot.date_peremption or '',
                lot.quantite_initiale, lot.statut, lot.qr_code or '',
            ])
        return response

    @action(detail=False, methods=['post'], url_path='import')
    def import_csv(self, request):
        if 'file' not in request.FILES:
            return Response({'error': 'Aucun fichier fourni.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            df = _read_csv_dataframe(request.FILES['file'])
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        required = {'article_code', 'numero_lot'}
        missing = required - set(df.columns)
        if missing:
            return Response({'error': f'Colonnes manquantes: {", ".join(missing)}'}, status=status.HTTP_400_BAD_REQUEST)

        valid_statuts = {c[0] for c in Lot._meta.get_field('statut').choices}
        success, errors = 0, []
        for i, row in df.iterrows():
            try:
                art_code = row['article_code'].strip()
                numero = row['numero_lot'].strip()
                if not art_code or not numero:
                    raise ValueError("article_code et numero_lot requis")
                article = Article.objects.filter(code_article=art_code).first()
                if article is None:
                    raise ValueError(f"Article inconnu: {art_code}")
                statut = row.get('statut', '').strip().lower() or 'actif'
                if statut not in valid_statuts:
                    raise ValueError(f"statut invalide: {statut}")
                Lot.objects.update_or_create(
                    article=article, numero_lot=numero,
                    defaults={
                        'date_fabrication': row.get('date_fabrication') or None,
                        'date_peremption': row.get('date_peremption') or None,
                        'quantite_initiale': row.get('quantite_initiale') or 0,
                        'statut': statut,
                        'qr_code': row.get('qr_code', '').strip() or None,
                    },
                )
                success += 1
            except Exception as e:
                errors.append({'row': int(i) + 2, 'message': str(e)})

        return Response({'success': success, 'total': len(df), 'errors': errors})


# ─── Mouvement ───────────────────────────────────────────────────────────────

class MouvementViewSet(viewsets.ModelViewSet):
    permission_classes = [IsStorageUser]
    serializer_class   = MouvementSerializer
    pagination_class   = StoragePagination
    filter_backends    = [filters.OrderingFilter]
    ordering           = ['-date_mouvement']
    http_method_names  = ['get', 'post', 'head', 'options']  # immutable history

    def get_queryset(self):
        qs = Mouvement.objects.select_related(
            'article', 'lot', 'placement_source', 'placement_source__entrepot',
            'placement_destination', 'placement_destination__entrepot', 'utilisateur'
        )
        search = self.request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(article__code_article__icontains=search) |
                Q(reference_document__icontains=search) |
                Q(commentaire__icontains=search)
            )
        article = self.request.query_params.get('article')
        if article:
            qs = qs.filter(article_id=article)
        type_mv = self.request.query_params.get('type_mouvement')
        if type_mv:
            qs = qs.filter(type_mouvement=type_mv)
        date_from = self.request.query_params.get('date_from')
        if date_from:
            qs = qs.filter(date_mouvement__date__gte=date_from)
        date_to = self.request.query_params.get('date_to')
        if date_to:
            qs = qs.filter(date_mouvement__date__lte=date_to)
        return qs

    def perform_create(self, serializer):
        with transaction.atomic():
            mouvement = serializer.save(utilisateur=self.request.user)
            self._update_stock(mouvement)

    def _locked_stock(self, mv, placement, create=False):
        if create:
            Stock.objects.get_or_create(
                article=mv.article, placement=placement, lot=mv.lot,
                defaults={'quantite_disponible': Decimal('0')}
            )
        return Stock.objects.select_for_update().get(article=mv.article, placement=placement, lot=mv.lot)

    def _update_stock(self, mv):
        typ = mv.type_mouvement

        if typ == 'entree':
            stock = self._locked_stock(mv, mv.placement_destination, create=True)
            stock.quantite_disponible += mv.quantite
            stock.save(update_fields=['quantite_disponible', 'derniere_maj'])
            self._refresh_placement_statut(mv.placement_destination)

        elif typ == 'sortie':
            try:
                stock = self._locked_stock(mv, mv.placement_source)
            except Stock.DoesNotExist:
                raise ValidationError({'placement_source': "Aucun stock de cet article à cet emplacement."})
            if mv.quantite > stock.quantite_disponible:
                raise ValidationError({'quantite': (
                    f"Stock insuffisant : {stock.quantite_disponible} disponible(s), {mv.quantite} demandé(s)."
                )})
            stock.quantite_disponible -= mv.quantite
            stock.save(update_fields=['quantite_disponible', 'derniere_maj'])
            self._refresh_placement_statut(mv.placement_source)

        elif typ == 'transfert':
            try:
                src = self._locked_stock(mv, mv.placement_source)
            except Stock.DoesNotExist:
                raise ValidationError({'placement_source': "Aucun stock de cet article à l'emplacement source."})
            if mv.quantite > src.quantite_disponible:
                raise ValidationError({'quantite': (
                    f"Stock insuffisant à l'emplacement source : {src.quantite_disponible} disponible(s), "
                    f"{mv.quantite} demandé(s)."
                )})
            src.quantite_disponible -= mv.quantite
            src.save(update_fields=['quantite_disponible', 'derniere_maj'])

            dst = self._locked_stock(mv, mv.placement_destination, create=True)
            dst.quantite_disponible += mv.quantite
            dst.save(update_fields=['quantite_disponible', 'derniere_maj'])

            self._refresh_placement_statut(mv.placement_source)
            self._refresh_placement_statut(mv.placement_destination)

        elif typ == 'ajustement':
            stock = self._locked_stock(mv, mv.placement_destination, create=True)
            stock.quantite_disponible = mv.quantite
            stock.save(update_fields=['quantite_disponible', 'derniere_maj'])
            self._refresh_placement_statut(mv.placement_destination)

    def _refresh_placement_statut(self, placement):
        if placement.statut == 'bloque':
            return
        total = placement.stocks.aggregate(t=Sum('quantite_disponible'))['t'] or Decimal('0')
        if placement.capacite_max:
            new_statut = 'plein' if total >= placement.capacite_max else 'disponible'
        else:
            new_statut = 'disponible'
        if placement.statut != new_statut:
            placement.statut = new_statut
            placement.save(update_fields=['statut'])

    @action(detail=True, methods=['post'], url_path='reverse')
    def reverse(self, request, pk=None):
        original = self.get_object()
        typ = original.type_mouvement

        if typ == 'entree':
            new_type, src, dst = 'sortie', original.placement_destination, None
        elif typ == 'sortie':
            new_type, src, dst = 'entree', None, original.placement_source
        elif typ == 'transfert':
            new_type, src, dst = 'transfert', original.placement_destination, original.placement_source
        else:
            return Response(
                {'error': "Les mouvements d'ajustement ne peuvent pas être annulés automatiquement — créez un nouvel ajustement avec la valeur correcte."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                reversal = Mouvement.objects.create(
                    article=original.article, lot=original.lot,
                    placement_source=src, placement_destination=dst,
                    type_mouvement=new_type, quantite=original.quantite,
                    reference_document=f"Annulation #{original.id}"[:200],
                    commentaire=f"Annulation automatique du mouvement #{original.id} ({original.get_type_mouvement_display()}).",
                    utilisateur=request.user,
                )
                self._update_stock(reversal)
        except ValidationError as exc:
            return Response({'error': f"Annulation impossible : {exc.detail}"}, status=status.HTTP_400_BAD_REQUEST)

        return Response(self.get_serializer(reversal).data, status=status.HTTP_201_CREATED)


# ─── Stock ────────────────────────────────────────────────────────────────────

class StockViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsStorageUser]
    serializer_class   = StockSerializer
    pagination_class   = StoragePagination
    filter_backends    = [filters.OrderingFilter]
    ordering           = ['article__code_article', 'placement__code_emplacement']

    def get_queryset(self):
        qs = Stock.objects.select_related(
            'article', 'lot', 'placement', 'placement__entrepot'
        ).filter(quantite_disponible__gt=0)
        search = self.request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(article__code_article__icontains=search) |
                Q(article__nom__icontains=search) |
                Q(placement__code_emplacement__icontains=search)
            )
        article = self.request.query_params.get('article')
        if article:
            qs = qs.filter(article_id=article)
        entrepot = self.request.query_params.get('entrepot')
        if entrepot:
            qs = qs.filter(placement__entrepot_id=entrepot)
        placement = self.request.query_params.get('placement')
        if placement:
            qs = qs.filter(placement_id=placement)
        if self.request.query_params.get('alerte_stock'):
            qs = [s for s in qs if float(s.quantite_disponible) <= s.article.seuil_alerte]
        return qs

    @action(detail=False, methods=['get'], url_path='resume')
    def resume(self, request):
        """GET /api/storage/stocks/resume/ — global inventory summary."""
        total_articles = Article.objects.filter(actif=True).count()
        total_alertes  = sum(
            1 for a in Article.objects.filter(actif=True).prefetch_related('stocks')
            if (a.stocks.aggregate(t=Sum('quantite_disponible'))['t'] or 0) <= a.seuil_alerte
        )
        lignes_stock   = Stock.objects.filter(quantite_disponible__gt=0).count()
        valeur_totale  = Stock.objects.filter(quantite_disponible__gt=0).aggregate(
            t=Sum(F('quantite_disponible') * F('article__prix_unitaire'))
        )['t'] or Decimal('0')
        total_reserve  = Stock.objects.aggregate(t=Sum('quantite_reservee'))['t'] or Decimal('0')
        today          = timezone.now().date()
        lots_perimes   = Lot.objects.filter(statut='perime').count()
        lots_proches   = Lot.objects.filter(
            statut='actif',
            date_peremption__gte=today,
            date_peremption__lte=today + timedelta(days=30),
        ).count()
        return Response({
            'total_articles': total_articles,
            'total_alertes':  total_alertes,
            'lignes_stock':   lignes_stock,
            'valeur_totale':  float(valeur_totale),
            'total_reserve':  float(total_reserve),
            'lots_perimes':   lots_perimes,
            'lots_proches':   lots_proches,
        })

    @action(detail=True, methods=['post'], url_path='reserve')
    def reserve(self, request, pk=None):
        with transaction.atomic():
            stock = Stock.objects.select_for_update().get(pk=self.get_object().pk)
            try:
                qty = Decimal(str(request.data.get('quantite', '0')))
            except InvalidOperation:
                return Response({'error': 'Quantité invalide.'}, status=status.HTTP_400_BAD_REQUEST)
            if qty <= 0:
                return Response({'error': 'La quantité doit être positive.'}, status=status.HTTP_400_BAD_REQUEST)
            disponible = stock.quantite_disponible - stock.quantite_reservee
            if qty > disponible:
                return Response(
                    {'error': f"Quantité disponible insuffisante pour réservation ({disponible})."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            stock.quantite_reservee += qty
            stock.save(update_fields=['quantite_reservee'])
        return Response(self.get_serializer(stock).data)

    @action(detail=True, methods=['post'], url_path='release')
    def release(self, request, pk=None):
        with transaction.atomic():
            stock = Stock.objects.select_for_update().get(pk=self.get_object().pk)
            try:
                qty = Decimal(str(request.data.get('quantite', '0')))
            except InvalidOperation:
                return Response({'error': 'Quantité invalide.'}, status=status.HTTP_400_BAD_REQUEST)
            if qty <= 0:
                return Response({'error': 'La quantité doit être positive.'}, status=status.HTTP_400_BAD_REQUEST)
            stock.quantite_reservee = max(Decimal('0'), stock.quantite_reservee - qty)
            stock.save(update_fields=['quantite_reservee'])
        return Response(self.get_serializer(stock).data)


# ─── Ticket ──────────────────────────────────────────────────────────────────

class TicketViewSet(viewsets.ModelViewSet):
    permission_classes = [IsStorageUser]
    serializer_class   = TicketSerializer
    pagination_class   = StoragePagination
    filter_backends    = [filters.OrderingFilter]
    ordering           = ['-date_scan']

    def get_queryset(self):
        qs = Ticket.objects.select_related('article', 'lot', 'placement', 'mouvement', 'utilisateur')
        search = self.request.query_params.get('search', '').strip()
        if search:
            qs = qs.filter(
                Q(qr_contenu__icontains=search) |
                Q(article__code_article__icontains=search) |
                Q(code_barre_genere__icontains=search)
            )
        type_source = self.request.query_params.get('type_source')
        if type_source:
            qs = qs.filter(type_source=type_source)
        statut = self.request.query_params.get('statut')
        if statut:
            qs = qs.filter(statut=statut)
        return qs

    def perform_create(self, serializer):
        serializer.save(utilisateur=self.request.user)

    from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone
from django.contrib.auth import get_user_model
from .models import ProductAccess  # Import model jdid li zti dejà

User = get_user_model()

@api_view(['POST'])
def grant_product_access(request):
    product_id = request.data.get('product_id')
    duration_minutes = request.data.get('duration_minutes')
    is_infinite = request.data.get('is_infinite', False)
    cocher_tous = request.data.get('cocher_tous', False)
    
    # Hna ghadi n-st3mlo direct l-id dyal product d storage
    if not product_id:
        return Response({"error": "product_id khass koun"}, status=status.HTTP_400_BAD_REQUEST)
        
    if cocher_tous:
        users = User.objects.filter(is_staff=False)  # Kollchi l-khdama
    else:
        user_id = request.data.get('user_id')
        users = User.objects.filter(id=user_id)

    for u in users:
        ProductAccess.objects.update_or_create(
            product_id=product_id,  # Rbaṭnah b l-ID direct bla mouchkil d s-smiya
            user=u,
            defaults={
                'duration_minutes': duration_minutes if not is_infinite else None,
                'is_infinite': is_infinite,
                'granted_at': timezone.now()  # Re-set d l-we9t jdid
            }
        )
    return Response({"message": "Permission nja7at!"}, status=status.HTTP_200_OK)


@api_view(['GET'])
def employee_product_history(request, user_id):
    accesses = ProductAccess.objects.filter(user_id=user_id)
    valid_products = []

    for access in accesses:
        # Dynamic calculation dyal l-we9t (10 min wla dynamic)
        if access.has_active_access():
            # Hna n-akhdo s-smiya d l-produit dynamic kifma m-smya 3ndkom f model d storage
            # safe path dyal l-file direct mn storage item dyalkom
            valid_products.append({
                "id": access.product_id,
                "infinite": access.is_infinite,
                "granted_at": access.granted_at
            })

    return Response(valid_products, status=status.HTTP_200_OK)
