from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


# ─── Choices ──────────────────────────────────────────────────────────────────

STATUT_ENTREPOT = [
    ('actif',        'Actif'),
    ('inactif',      'Inactif'),
    ('maintenance',  'Maintenance'),
]

STATUT_PLACEMENT = [
    ('disponible', 'Disponible'),
    ('plein',      'Plein'),
    ('bloque',     'Bloqué'),
]

STATUT_LOT = [
    ('actif',   'Actif'),
    ('perime',  'Périmé'),
    ('epuise',  'Épuisé'),
]

TYPE_MOUVEMENT = [
    ('entree',      'Entrée'),
    ('sortie',      'Sortie'),
    ('transfert',   'Transfert'),
    ('ajustement',  'Ajustement'),
]

TYPE_SOURCE_TICKET = [
    ('article',   'Article'),
    ('lot',       'Lot'),
    ('placement', 'Placement'),
]

STATUT_TICKET = [
    ('genere',   'Généré'),
    ('imprime',  'Imprimé'),
    ('annule',   'Annulé'),
]


# ─── Catégorie ────────────────────────────────────────────────────────────────

class Categorie(models.Model):
    code_categorie = models.CharField(max_length=50, unique=True, db_index=True)
    nom            = models.CharField(max_length=200)
    description    = models.TextField(blank=True)
    parent         = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='sous_categories'
    )

    class Meta:
        ordering     = ['nom']
        verbose_name = 'Catégorie'

    def __str__(self):
        return f"{self.code_categorie} — {self.nom}"


# ─── Article ──────────────────────────────────────────────────────────────────

class Article(models.Model):
    code_article    = models.CharField(max_length=100, unique=True, db_index=True)
    nom             = models.CharField(max_length=200)
    description     = models.TextField(blank=True)
    categorie       = models.ForeignKey(
        Categorie, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='articles'
    )
    unite_mesure    = models.CharField(max_length=50, default='pcs')
    prix_unitaire   = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    duree_vie_jours = models.PositiveIntegerField(null=True, blank=True)
    seuil_alerte    = models.PositiveIntegerField(default=0)
    qr_code         = models.CharField(max_length=200, unique=True, null=True, blank=True)
    code_barre      = models.CharField(max_length=200, unique=True, null=True, blank=True)
    actif           = models.BooleanField(default=True, help_text="Décochez pour désactiver sans supprimer l'historique.")
    date_creation   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering     = ['code_article']
        verbose_name = 'Article'

    def __str__(self):
        return f"{self.code_article} — {self.nom}"


# ─── Entrepôt ─────────────────────────────────────────────────────────────────

class Entrepot(models.Model):
    code_entrepot = models.CharField(max_length=50, unique=True, db_index=True)
    nom           = models.CharField(max_length=200)
    adresse       = models.TextField(blank=True)
    ville         = models.CharField(max_length=100, blank=True)
    responsable   = models.CharField(max_length=200, blank=True)
    capacite_max  = models.PositiveIntegerField(null=True, blank=True)
    statut        = models.CharField(max_length=20, choices=STATUT_ENTREPOT, default='actif')

    class Meta:
        ordering     = ['nom']
        verbose_name = 'Entrepôt'

    def __str__(self):
        return f"{self.code_entrepot} — {self.nom}"


# ─── Placement ────────────────────────────────────────────────────────────────

class Placement(models.Model):
    entrepot        = models.ForeignKey(Entrepot, on_delete=models.CASCADE, related_name='placements')
    code_emplacement = models.CharField(max_length=50, db_index=True)
    zone            = models.CharField(max_length=50, blank=True)
    allee           = models.CharField(max_length=50, blank=True)
    niveau          = models.CharField(max_length=50, blank=True)
    capacite_max    = models.PositiveIntegerField(null=True, blank=True)
    statut          = models.CharField(max_length=20, choices=STATUT_PLACEMENT, default='disponible')
    qr_code         = models.CharField(max_length=200, unique=True, null=True, blank=True)

    class Meta:
        unique_together = [('entrepot', 'code_emplacement')]
        ordering        = ['entrepot', 'code_emplacement']
        verbose_name    = 'Placement'

    def __str__(self):
        return f"{self.entrepot.code_entrepot} / {self.code_emplacement}"


# ─── Lot ─────────────────────────────────────────────────────────────────────

class Lot(models.Model):
    article           = models.ForeignKey(Article, on_delete=models.CASCADE, related_name='lots')
    numero_lot        = models.CharField(max_length=100, db_index=True)
    date_fabrication  = models.DateField(null=True, blank=True)
    date_peremption   = models.DateField(null=True, blank=True, db_index=True)
    quantite_initiale = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    statut            = models.CharField(max_length=20, choices=STATUT_LOT, default='actif')
    qr_code           = models.CharField(max_length=200, unique=True, null=True, blank=True)

    class Meta:
        unique_together = [('article', 'numero_lot')]
        ordering        = ['date_peremption', 'numero_lot']
        verbose_name    = 'Lot'

    def __str__(self):
        return f"{self.article.code_article} — Lot {self.numero_lot}"


# ─── Mouvement ───────────────────────────────────────────────────────────────

class Mouvement(models.Model):
    article                = models.ForeignKey(Article, on_delete=models.CASCADE, related_name='mouvements')
    lot                    = models.ForeignKey(
        Lot, on_delete=models.SET_NULL, null=True, blank=True, related_name='mouvements'
    )
    placement_source       = models.ForeignKey(
        Placement, on_delete=models.SET_NULL, null=True, blank=True, related_name='mouvements_source'
    )
    placement_destination  = models.ForeignKey(
        Placement, on_delete=models.SET_NULL, null=True, blank=True, related_name='mouvements_destination'
    )
    type_mouvement         = models.CharField(max_length=20, choices=TYPE_MOUVEMENT, db_index=True)
    quantite               = models.DecimalField(
        max_digits=12, decimal_places=2,
        validators=[MinValueValidator(Decimal('0'))],
    )
    date_mouvement         = models.DateTimeField(auto_now_add=True)
    reference_document     = models.CharField(max_length=200, blank=True)
    utilisateur            = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='mouvements_stock'
    )
    commentaire            = models.TextField(blank=True)

    class Meta:
        ordering     = ['-date_mouvement']
        verbose_name = 'Mouvement'

    def __str__(self):
        return f"{self.get_type_mouvement_display()} — {self.article.code_article} — {self.quantite}"


# ─── Stock ───────────────────────────────────────────────────────────────────

class Stock(models.Model):
    article             = models.ForeignKey(Article, on_delete=models.CASCADE, related_name='stocks')
    placement           = models.ForeignKey(Placement, on_delete=models.CASCADE, related_name='stocks')
    lot                 = models.ForeignKey(
        Lot, on_delete=models.SET_NULL, null=True, blank=True, related_name='stocks'
    )
    quantite_disponible = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    quantite_reservee   = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        validators=[MinValueValidator(Decimal('0'))],
        help_text="Quantité réservée (allouée) sur ce stock, non disponible pour sortie/transfert.",
    )
    derniere_maj        = models.DateTimeField(auto_now=True)

    class Meta:
        ordering     = ['article', 'placement']
        verbose_name = 'Stock'
        constraints  = [
            models.UniqueConstraint(
                fields=['article', 'placement', 'lot'],
                condition=models.Q(lot__isnull=False),
                name='unique_stock_with_lot',
            ),
            models.UniqueConstraint(
                fields=['article', 'placement'],
                condition=models.Q(lot__isnull=True),
                name='unique_stock_without_lot',
            ),
        ]

    def __str__(self):
        lot_str = f" / Lot {self.lot.numero_lot}" if self.lot else ""
        return f"{self.article.code_article}{lot_str} @ {self.placement.code_emplacement} — {self.quantite_disponible}"


# ─── Ticket ──────────────────────────────────────────────────────────────────

class Ticket(models.Model):
    qr_contenu        = models.TextField()
    type_source       = models.CharField(max_length=20, choices=TYPE_SOURCE_TICKET, db_index=True)
    article           = models.ForeignKey(
        Article, on_delete=models.SET_NULL, null=True, blank=True, related_name='tickets'
    )
    lot               = models.ForeignKey(
        Lot, on_delete=models.SET_NULL, null=True, blank=True, related_name='tickets'
    )
    placement         = models.ForeignKey(
        Placement, on_delete=models.SET_NULL, null=True, blank=True, related_name='tickets'
    )
    code_barre_genere = models.CharField(max_length=200, blank=True)
    mouvement         = models.ForeignKey(
        Mouvement, on_delete=models.SET_NULL, null=True, blank=True, related_name='tickets'
    )
    date_scan         = models.DateTimeField(auto_now_add=True)
    utilisateur       = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='tickets_scan'
    )
    statut            = models.CharField(max_length=20, choices=STATUT_TICKET, default='genere')

    class Meta:
        ordering     = ['-date_scan']
        verbose_name = 'Ticket'

    def __str__(self):
        return f"Ticket #{self.pk} — {self.type_source} — {self.date_scan:%Y-%m-%d %H:%M}"

from django.db import models
from django.contrib.auth import get_user_model
from django.utils import timezone
from datetime import timedelta

User = get_user_model()

# L-Model jdid d l-Permissions b l-Timer
class ProductAccess(models.Model):
    # Hna ghadi n-rbtouh m3a l-Model d l-fichiers wla l-produits li 3ndkom f storage
    # f blast 'Product', ila l9iti l-model f storage smito 'StorageItem' wla chi 7aja, ghadi n-beddloha
    product = models.ForeignKey('Product', on_delete=models.CASCADE, related_name='accesses')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='product_accesses')
    granted_at = models.DateTimeField(auto_now_add=True)
    duration_minutes = models.IntegerField(null=True, blank=True) # Choice d l-admin (10 min, 1h...)
    is_infinite = models.BooleanField(default=False) # À vie

    def has_active_access(self):
        if self.is_infinite:
            return True
        if not self.duration_minutes:
            return False
        return timezone.now() < self.granted_at + timedelta(minutes=self.duration_minutes)
