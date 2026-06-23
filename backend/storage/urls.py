from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import (
    ArticleViewSet, CategorieViewSet, EntrepotViewSet,
    LotViewSet, MouvementViewSet, PlacementViewSet,
    StockViewSet, TicketViewSet,
)

router = DefaultRouter()
router.register(r'articles',   ArticleViewSet,   basename='article')
router.register(r'categories', CategorieViewSet, basename='categorie')
router.register(r'entrepots',  EntrepotViewSet,  basename='entrepot')
router.register(r'placements', PlacementViewSet, basename='placement')
router.register(r'lots',       LotViewSet,       basename='lot')
router.register(r'mouvements', MouvementViewSet, basename='mouvement')
router.register(r'stocks',     StockViewSet,     basename='stock')
router.register(r'tickets',    TicketViewSet,    basename='ticket')

urlpatterns = [
    path('', include(router.urls)),
    path('grant-access/', views.grant_product_access, name='grant_product_access'),
    path('employee-history/<int:user_id>/', views.employee_product_history, name='employee_product_history'),
]
