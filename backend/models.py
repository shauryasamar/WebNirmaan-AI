from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import Boolean, Column, DateTime, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Role(SQLModel, table=True):
    __tablename__ = "roles"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    name: str = Field(index=True, unique=True, nullable=False)
    description: Optional[str] = Field(default=None, nullable=True)
    is_system: bool = Field(default=False, nullable=False)
    permissions: list[str] = Field(
        default=[],
        sa_column=Column(JSONB, nullable=False, default=[]),
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class Admin(SQLModel, table=True):
    __tablename__ = "admins"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    email: str = Field(index=True, unique=True)
    name: Optional[str] = Field(default=None)
    gender: Optional[str] = Field(default=None)
    phone: Optional[str] = Field(default=None)
    avatar_url: Optional[str] = Field(default=None)
    role: str = Field(default="super_admin")
    role_id: Optional[UUID] = Field(default=None, foreign_key="roles.id", nullable=True)
    additional_permissions: Optional[list[str]] = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    website_access_type: str = Field(default="all")  # "all" | "specific"
    status: str = Field(default="active")  # "active" | "inactive" | "pending"
    invitation_token: Optional[str] = Field(default=None, nullable=True, index=True)
    invitation_expires_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    invited_by_admin_id: Optional[UUID] = Field(default=None, foreign_key="admins.id", nullable=True)
    auth_provider: str = Field(default="email")
    google_id: Optional[str] = Field(default=None)
    is_verified: bool = Field(default=True)
    is_active: bool = Field(default=True)
    timezone: str = Field(default="Asia/Kolkata")
    reset_token: Optional[str] = Field(default=None)
    reset_token_expires_at: Optional[datetime] = Field(default=None)
    last_login_at: Optional[datetime] = Field(default=None)
    last_login_ip: Optional[str] = Field(default=None)
    password_hash: Optional[str] = Field(default=None)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Site(SQLModel, table=True):
    __tablename__ = "sites"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    slug: str = Field(index=True, unique=True)
    site_definition: dict[str, Any] = Field(
        sa_column=Column(JSONB, nullable=False)
    )
    draft_definition: Optional[dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    checkout_settings: Optional[dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    default_return_window_days: int = Field(
        default=7,
        sa_column=Column(Integer, nullable=False, default=7),
    )
    is_online: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True, index=True),
    )
    version: int = Field(default=1, nullable=False)
    @property
    def name(self) -> str:
        if self.site_definition and isinstance(self.site_definition, dict):
            return self.site_definition.get("site_name") or self.site_definition.get("name") or self.slug
        return self.slug

    @property
    def is_published(self) -> bool:
        if self.site_definition and isinstance(self.site_definition, dict):
            return bool(self.site_definition.get("pages") is not None)
        return False

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class AdminSite(SQLModel, table=True):
    __tablename__ = "admin_sites"

    admin_id: UUID = Field(foreign_key="admins.id", primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", primary_key=True)
    role_on_site: str = Field(default="owner")
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class User(SQLModel, table=True):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("site_id", "email", name="uq_users_site_email"),)

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)

    name: Optional[str] = Field(default=None, nullable=True)
    email: Optional[str] = Field(default=None, index=True, nullable=True)
    phone: Optional[str] = Field(default=None, nullable=True)
    gender: Optional[str] = Field(default=None, nullable=True)
    date_of_birth: Optional[str] = Field(default=None, nullable=True)
    password_hash: Optional[str] = Field(default=None, nullable=True)
    auth_provider: str = Field(default="local", nullable=False)
    google_id: Optional[str] = Field(default=None, nullable=True)
    avatar_url: Optional[str] = Field(default=None, nullable=True)
    reset_token: Optional[str] = Field(default=None, nullable=True)
    reset_token_expires_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    is_guest: bool = Field(default=False, nullable=False)
    is_active: bool = Field(default=True, nullable=False)

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class UserAddress(SQLModel, table=True):
    __tablename__ = "user_addresses"
    __table_args__ = (
        Index("ix_user_addresses_user_id", "user_id"),
        Index("ix_user_addresses_site_id", "site_id"),
        Index("ix_user_addresses_user_active", "user_id", "is_active"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", nullable=False)
    user_id: UUID = Field(foreign_key="users.id", nullable=False)

    full_name: str = Field(max_length=255, nullable=False)
    mobile_number: str = Field(max_length=30, nullable=False)
    address_line1: str = Field(max_length=255, nullable=False)
    city: str = Field(max_length=120, nullable=False)
    postal_code: str = Field(max_length=20, nullable=False)
    email: Optional[str] = Field(default=None, max_length=255, nullable=True)
    address_type: str = Field(max_length=30, nullable=False)

    is_default: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    is_active: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )

    # Geo-location (pinned or geocoded)
    latitude: Optional[float] = Field(default=None, nullable=True)
    longitude: Optional[float] = Field(default=None, nullable=True)
    geo_accuracy: Optional[str] = Field(default=None, max_length=30, nullable=True)  # 'pinned' | 'geocoded'


class Category(SQLModel, table=True):
    __tablename__ = "categories"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)
    name: str = Field(max_length=255, nullable=False)
    slug: Optional[str] = Field(default=None, max_length=255)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class Collection(SQLModel, table=True):
    __tablename__ = "collections"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)
    name: str = Field(max_length=255, nullable=False)
    slug: Optional[str] = Field(default=None, max_length=255)
    description: str = Field(default="")
    is_badge: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    badge_color: Optional[str] = Field(default=None, max_length=50, nullable=True)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class ProductCollection(SQLModel, table=True):
    __tablename__ = "product_collections"
    __table_args__ = (
        UniqueConstraint("product_id", "collection_id", name="uq_product_collections_product_collection"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    product_id: UUID = Field(foreign_key="products.id", index=True)
    collection_id: UUID = Field(foreign_key="collections.id", index=True)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Product(SQLModel, table=True):
    __tablename__ = "products"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)
    category_id: Optional[UUID] = Field(default=None, foreign_key="categories.id", index=True)

    name: str
    brand: Optional[str] = Field(default=None, index=True)
    category: Optional[str] = Field(default=None, index=True)
    description: str = Field(default="")
    slug: Optional[str] = Field(default=None, index=True)

    price: Decimal = Field(sa_column=Column(Numeric(12, 2), nullable=False))
    compare_price: Optional[Decimal] = Field(
        default=None,
        sa_column=Column(Numeric(12, 2), nullable=True),
    )

    stock: int = Field(default=0, nullable=False)
    in_stock: bool = Field(default=True, nullable=False)
    is_active: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )
    sku: Optional[str] = Field(default=None, max_length=100, nullable=True, index=True)
    hsn_code: Optional[str] = Field(default=None, max_length=50, nullable=True)
    video_url: Optional[str] = Field(default=None, nullable=True)
    video_position: Optional[int] = Field(
        default=2,
        sa_column=Column(Integer, nullable=True, default=2),
    )
    sibling_group: Optional[str] = Field(default=None, max_length=100, nullable=True, index=True)
    sibling_label: Optional[str] = Field(default=None, max_length=100, nullable=True)
    weight_grams: int = Field(default=500, nullable=False)  # used for shipping label weight
    length_cm: Optional[float] = Field(
        default=None,
        sa_column=Column(Numeric(8, 2), nullable=True),
    )
    width_cm: Optional[float] = Field(
        default=None,
        sa_column=Column(Numeric(8, 2), nullable=True),
    )
    height_cm: Optional[float] = Field(
        default=None,
        sa_column=Column(Numeric(8, 2), nullable=True),
    )
    return_window_days: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )

    images: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False),
    )
    highlights: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False),
    )
    variant_option: Optional[dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class ProductReview(SQLModel, table=True):
    __tablename__ = "product_reviews"
    __table_args__ = (
        Index("ix_product_reviews_site_id", "site_id"),
        Index("ix_product_reviews_product_id", "product_id"),
        Index("ix_product_reviews_customer_id", "customer_id"),
        Index("ix_product_reviews_order_id", "order_id"),
        Index("ix_product_reviews_created_at", "created_at"),
        UniqueConstraint("order_item_id", name="uq_product_reviews_order_item"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)
    product_id: UUID = Field(foreign_key="products.id", index=True)
    customer_id: UUID = Field(foreign_key="users.id", index=True)
    order_id: UUID = Field(foreign_key="orders.id", index=True)
    order_item_id: UUID = Field(foreign_key="order_items.id", index=True)

    rating: int = Field(nullable=False)
    review_text: str = Field(default="", nullable=False)
    review_images: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False),
    )

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class Cart(SQLModel, table=True):
    __tablename__ = "carts"
    __table_args__ = (UniqueConstraint("site_id", "user_id", name="uq_carts_site_user"),)

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class CartItem(SQLModel, table=True):
    __tablename__ = "cart_items"
    __table_args__ = (
        UniqueConstraint(
            "cart_id",
            "product_id",
            "selected_variant_value",
            name="uq_cart_items_cart_product_variant",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    cart_id: UUID = Field(foreign_key="carts.id", index=True)
    product_id: UUID = Field(foreign_key="products.id", index=True)

    quantity: int = Field(default=1, nullable=False)

    selected_variant_label: Optional[str] = Field(default=None)
    selected_variant_value: Optional[str] = Field(default=None)

    unit_price: Decimal = Field(sa_column=Column(Numeric(12, 2), nullable=False))
    compare_price: Optional[Decimal] = Field(
        default=None,
        sa_column=Column(Numeric(12, 2), nullable=True),
    )

    product_name: str = Field(default="", nullable=False)
    product_image: Optional[str] = Field(default=None)
    product_slug: Optional[str] = Field(default=None)

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class Order(SQLModel, table=True):
    __tablename__ = "orders"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)
    customer_id: UUID = Field(foreign_key="users.id", index=True)
    shipping_address_id: Optional[UUID] = Field(default=None, foreign_key="user_addresses.id")
    items: list[dict[str, Any]] = Field(sa_column=Column(JSONB, nullable=False))
    shipping_address: Optional[dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    pricing_snapshot: Optional[dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    payment_method: Optional[str] = Field(default=None, max_length=30)
    payment_status: str = Field(default="pending", max_length=30, nullable=False)
    razorpay_order_id: Optional[str] = Field(default=None, index=True)
    razorpay_payment_id: Optional[str] = Field(default=None, index=True)
    razorpay_signature: Optional[str] = Field(default=None)
    platform_fee: Decimal = Field(
        default=Decimal("0.00"),
        sa_column=Column(Numeric(12, 2), nullable=False),
    )
    tenant_share: Decimal = Field(
        default=Decimal("0.00"),
        sa_column=Column(Numeric(12, 2), nullable=False),
    )
    status: str = Field(default="placed", nullable=False)
    cancel_reason: Optional[str] = Field(default=None)
    coupon_code: Optional[str] = Field(default=None, max_length=50, nullable=True)
    discount_amount: Decimal = Field(
        default=Decimal("0.00"),
        sa_column=Column(Numeric(12, 2), nullable=False, default=Decimal("0.00")),
    )
    total: Decimal = Field(sa_column=Column(Numeric(12, 2), nullable=False))
    confirmed_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    shipped_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    delivered_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    return_window_closes_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    escrow_status: str = Field(default="held", max_length=30, nullable=False)
    escrow_unheld_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    delivery_otp: Optional[str] = Field(default=None, max_length=10, nullable=True)
    cancelled_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class OrderItem(SQLModel, table=True):
    __tablename__ = "order_items"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    order_id: UUID = Field(foreign_key="orders.id", index=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)
    product_id: Optional[UUID] = Field(default=None, foreign_key="products.id", index=True, nullable=True)

    product_name: str
    product_slug: Optional[str] = Field(default=None)
    product_image: Optional[str] = Field(default=None)

    selected_variant_label: Optional[str] = Field(default=None)
    selected_variant_value: Optional[str] = Field(default=None)

    unit_price: Decimal = Field(sa_column=Column(Numeric(12, 2), nullable=False))
    compare_price: Optional[Decimal] = Field(
        default=None,
        sa_column=Column(Numeric(12, 2), nullable=True),
    )
    quantity: int = Field(nullable=False)
    line_total: Decimal = Field(sa_column=Column(Numeric(12, 2), nullable=False))
    status: str = Field(default="placed", max_length=40, nullable=False)
    returnable_quantity: int = Field(default=0, nullable=False)
    return_window_days: int = Field(
        default=7,
        sa_column=Column(Integer, nullable=False, default=7),
    )
    pricing_snapshot: Optional[dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class Coupon(SQLModel, table=True):
    __tablename__ = "coupons"
    __table_args__ = (
        UniqueConstraint("site_id", "code", name="uq_site_coupons_code"),
        Index("ix_coupons_site_id_code", "site_id", "code"),
        Index("ix_coupons_site_id_is_active", "site_id", "is_active"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)

    code: str = Field(max_length=50, nullable=False)
    description: Optional[str] = Field(default="", nullable=True)

    discount_type: str = Field(default="percentage", max_length=30, nullable=False)
    discount_value: Decimal = Field(
        default=Decimal("0.00"),
        sa_column=Column(Numeric(10, 2), nullable=False),
    )
    max_discount_amount: Optional[Decimal] = Field(
        default=None,
        sa_column=Column(Numeric(10, 2), nullable=True),
    )

    applies_to: str = Field(
        default="all",
        sa_column=Column(String(30), nullable=False, default="all"),
    )
    collection_ids: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, default=list),
    )
    category_ids: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSONB, nullable=False, default=list),
    )

    min_order_value: Decimal = Field(
        default=Decimal("0.00"),
        sa_column=Column(Numeric(10, 2), nullable=False, default=Decimal("0.00")),
    )
    is_first_order_only: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )

    total_usage_limit: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
    times_used: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    per_customer_limit: int = Field(
        default=1,
        sa_column=Column(Integer, nullable=False, default=1),
    )

    starts_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    expires_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    is_active: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )
    is_public: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class CouponUsage(SQLModel, table=True):
    __tablename__ = "coupon_usages"
    __table_args__ = (
        Index("ix_coupon_usages_site_id_coupon_id", "site_id", "coupon_id"),
        Index("ix_coupon_usages_customer_email", "site_id", "customer_email"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)
    coupon_id: UUID = Field(foreign_key="coupons.id", index=True)
    order_id: UUID = Field(foreign_key="orders.id", index=True)
    user_id: Optional[UUID] = Field(default=None, foreign_key="users.id", nullable=True)

    customer_email: str = Field(max_length=255, nullable=False)
    discount_amount: Decimal = Field(
        default=Decimal("0.00"),
        sa_column=Column(Numeric(10, 2), nullable=False),
    )
    used_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Shipment(SQLModel, table=True):
    __tablename__ = "shipments"
    __table_args__ = (
        Index("ix_shipments_order_id", "order_id"),
        Index("ix_shipments_site_id", "site_id"),
        Index("ix_shipments_status", "status"),
        Index("ix_shipments_delivery_mode", "delivery_mode"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    order_id: UUID = Field(foreign_key="orders.id", index=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)

    # Delivery mode: own_agent | shiprocket | manual
    delivery_mode: str = Field(default="manual", max_length=30, nullable=False)

    # Unified status across all modes
    # pending | assigned | accepted | picked_up | in_transit | out_for_delivery | delivered | failed | rto
    status: str = Field(default="pending", max_length=40, nullable=False)

    @property
    def mode(self) -> str:
        return self.delivery_mode

    @mode.setter
    def mode(self, value: str):
        self.delivery_mode = value

    # Own-agent fields
    agent_id: Optional[UUID] = Field(default=None, foreign_key="delivery_agents.id", nullable=True)
    agent_token: Optional[str] = Field(default=None, max_length=128, nullable=True)  # signed one-time URL token
    agent_accepted_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    agent_picked_up_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    # Courier fields (Shiprocket / Delhivery / BlueDart)
    courier_name: Optional[str] = Field(default=None, max_length=100, nullable=True)
    courier_order_id: Optional[str] = Field(default=None, max_length=100, nullable=True)
    awb_number: Optional[str] = Field(default=None, max_length=100, nullable=True)
    label_url: Optional[str] = Field(default=None, nullable=True)
    tracking_url: Optional[str] = Field(default=None, nullable=True)

    # Legacy / manual fields (kept for backwards compat)
    delivery_partner_name: Optional[str] = Field(default=None, max_length=255)
    delivery_partner_phone: Optional[str] = Field(default=None, max_length=30)

    # Shared
    estimated_delivery_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    shipped_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    out_for_delivery_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    delivered_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    proof_of_delivery_url: Optional[str] = Field(default=None, nullable=True)
    delivery_otp: Optional[str] = Field(default=None, max_length=10, nullable=True)
    notes: Optional[str] = Field(default=None)

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class DeliveryAgent(SQLModel, table=True):
    """An own delivery agent registered by a tenant (admin)."""
    __tablename__ = "delivery_agents"
    __table_args__ = (
        Index("ix_delivery_agents_site_id", "site_id"),
        Index("ix_delivery_agents_site_active", "site_id", "is_active"),
        Index("ix_delivery_agents_site_phone", "site_id", "phone"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", nullable=False)

    name: str = Field(max_length=255, nullable=False)
    phone: str = Field(max_length=30, nullable=False)  # WhatsApp / SMS number
    password_hash: Optional[str] = Field(default=None, max_length=255, nullable=True)
    vehicle_type: str = Field(default="bike", max_length=50, nullable=False)
    is_active: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )
    current_order_count: int = Field(default=0, nullable=False)  # live load metric
    total_deliveries: int = Field(default=0, nullable=False)
    cash_in_hand: float = Field(default=0.0, nullable=False)
    last_active_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class DeliverySettings(SQLModel, table=True):
    """Per-tenant delivery configuration: mode, courier credentials, pickup address."""
    __tablename__ = "delivery_settings"

    site_id: UUID = Field(foreign_key="sites.id", primary_key=True)

    # Mode: own_agent | shiprocket | hybrid | manual
    delivery_mode: str = Field(default="manual", max_length=30, nullable=False)

    # Independent delivery channel toggles
    enable_fleet: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )
    enable_shiprocket: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    enable_manual: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )

    # Hybrid mode: orders within this radius use own agents, outside go to courier
    own_delivery_radius_km: float = Field(default=10.0, nullable=False)

    # Open pickup toggle: whether own delivery fleet riders can self-claim unassigned orders from the store pool
    allow_open_pickup: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )

    # Shiprocket credentials (password stored encrypted)
    shiprocket_email: Optional[str] = Field(default=None, max_length=255, nullable=True)
    shiprocket_password_encrypted: Optional[str] = Field(default=None, nullable=True)
    shiprocket_token: Optional[str] = Field(default=None, nullable=True)
    shiprocket_token_expires_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    # Courier preferences
    default_courier_preference: Optional[str] = Field(default=None, max_length=60, nullable=True)
    auto_assign_courier: bool = Field(
        default=True,
        sa_column=Column(Boolean, nullable=False, default=True),
    )

    # Sender / pickup address (for shipping labels)
    sender_name: Optional[str] = Field(default=None, max_length=255, nullable=True)
    sender_phone: Optional[str] = Field(default=None, max_length=30, nullable=True)
    sender_address: Optional[str] = Field(default=None, nullable=True)
    sender_pincode: Optional[str] = Field(default=None, max_length=10, nullable=True)
    sender_city: Optional[str] = Field(default=None, max_length=100, nullable=True)
    sender_state: Optional[str] = Field(default=None, max_length=100, nullable=True)

    # Default product weight fallback (grams) when product.weight_grams is 0
    default_weight_grams: int = Field(default=500, nullable=False)

    # Store / sender geo-location (for accurate delivery radius calculations)
    sender_latitude: Optional[float] = Field(default=None, nullable=True)
    sender_longitude: Optional[float] = Field(default=None, nullable=True)

    # Optional Shiprocket courier max delivery distance in KM (None or 0 = nationwide unlimited)
    shiprocket_delivery_radius_km: Optional[float] = Field(default=None, nullable=True)

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class InventoryMovement(SQLModel, table=True):
    __tablename__ = "inventory_movements"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)
    product_id: Optional[UUID] = Field(default=None, foreign_key="products.id", index=True, nullable=True)
    order_id: Optional[UUID] = Field(default=None, foreign_key="orders.id")
    order_item_id: Optional[UUID] = Field(default=None, foreign_key="order_items.id")
    movement_type: str = Field(max_length=40, nullable=False)
    quantity_delta: int = Field(nullable=False)
    note: Optional[str] = Field(default=None)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class OrderStatusHistory(SQLModel, table=True):
    __tablename__ = "order_status_history"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    order_id: UUID = Field(foreign_key="orders.id", index=True)
    status: str
    changed_by: Optional[UUID] = Field(default=None, index=True)
    changed_by_type: str = Field(default="admin", max_length=30, nullable=False)
    notes: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    changed_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class ReturnRequest(SQLModel, table=True):
    __tablename__ = "return_requests"
    __table_args__ = (
        Index("ix_return_requests_site_status", "site_id", "status"),
        Index("ix_return_requests_customer_status", "customer_id", "status"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)
    order_id: UUID = Field(foreign_key="orders.id", index=True)
    customer_id: UUID = Field(foreign_key="users.id", index=True)

    status: str = Field(default="requested", max_length=40, nullable=False)
    refund_status: str = Field(default="pending", max_length=40, nullable=False)

    request_note: Optional[str] = Field(default=None)
    admin_note: Optional[str] = Field(default=None)
    rejection_reason: Optional[str] = Field(default=None)
    refund_override_reason: Optional[str] = Field(default=None)

    suggested_refund_amount: Decimal = Field(
        default=Decimal("0.00"),
        sa_column=Column(Numeric(12, 2), nullable=False),
    )
    final_refund_amount: Decimal = Field(
        default=Decimal("0.00"),
        sa_column=Column(Numeric(12, 2), nullable=False),
    )

    refund_method: Optional[str] = Field(default=None, max_length=40)
    customer_refund_account: Optional[dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    pickup_status: Optional[str] = Field(default=None, max_length=40)
    pickup_details: Optional[dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )

    approved_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    rejected_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    received_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    inspected_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    refunded_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    closed_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class ReturnItem(SQLModel, table=True):
    __tablename__ = "return_items"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    return_request_id: UUID = Field(foreign_key="return_requests.id", index=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)
    order_id: UUID = Field(foreign_key="orders.id", index=True)
    order_item_id: UUID = Field(foreign_key="order_items.id", index=True)
    product_id: Optional[UUID] = Field(default=None, foreign_key="products.id", index=True, nullable=True)

    product_name: str
    product_slug: Optional[str] = Field(default=None)
    product_image: Optional[str] = Field(default=None)

    selected_variant_label: Optional[str] = Field(default=None)
    selected_variant_value: Optional[str] = Field(default=None)

    quantity_requested: int = Field(nullable=False)
    quantity_approved: int = Field(default=0, nullable=False)
    quantity_received: int = Field(default=0, nullable=False)

    reason_code: str = Field(max_length=60, nullable=False)
    reason_note: Optional[str] = Field(default=None)

    unit_price_paid: Decimal = Field(
        sa_column=Column(Numeric(12, 2), nullable=False)
    )
    line_refund_suggested: Decimal = Field(
        default=Decimal("0.00"),
        sa_column=Column(Numeric(12, 2), nullable=False),
    )
    line_refund_final: Decimal = Field(
        default=Decimal("0.00"),
        sa_column=Column(Numeric(12, 2), nullable=False),
    )

    restock_decision: Optional[str] = Field(default=None, max_length=30)
    restocked_quantity: int = Field(default=0, nullable=False)

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class ReturnStatusHistory(SQLModel, table=True):
    __tablename__ = "return_status_history"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    return_request_id: UUID = Field(foreign_key="return_requests.id", index=True)
    status: str = Field(max_length=40, nullable=False)
    changed_by: Optional[UUID] = Field(default=None, index=True)
    changed_by_type: str = Field(default="admin", max_length=30, nullable=False)
    note: Optional[str] = Field(default=None)
    changed_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class SiteDefinitionHistory(SQLModel, table=True):
    __tablename__ = "site_definition_history"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True)
    site_definition: dict[str, Any] = Field(sa_column=Column(JSONB, nullable=False))
    saved_by: UUID = Field(foreign_key="admins.id", index=True)
    saved_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class TenantBankAccount(SQLModel, table=True):
    __tablename__ = "tenant_bank_accounts"
    __table_args__ = (
        Index("ix_tenant_bank_accounts_admin_id", "admin_id"),
        Index("ix_tenant_bank_accounts_site_id", "site_id"),
        Index("ix_tenant_bank_accounts_razorpay_account_id", "razorpay_account_id"),
        UniqueConstraint("site_id", name="uq_tenant_bank_accounts_site"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    admin_id: UUID = Field(foreign_key="admins.id", nullable=False)
    site_id: UUID = Field(foreign_key="sites.id", nullable=False)

    account_holder_name: str = Field(max_length=255, nullable=False)
    account_number_encrypted: str = Field(sa_column=Column(String, nullable=False))
    account_number_last4: str = Field(max_length=4, nullable=False)
    ifsc_code: str = Field(max_length=15, nullable=False)
    bank_name: str = Field(max_length=150, nullable=False)
    pan_number: Optional[str] = Field(default=None, max_length=10)
    gst_number: Optional[str] = Field(default=None, max_length=20)

    # Razorpay Route Linked Account Integration
    razorpay_account_id: Optional[str] = Field(default=None, max_length=64, nullable=True)
    route_status: str = Field(default="pending", max_length=30, nullable=False)
    route_onboarded_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    is_verified: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class TenantLedgerEntry(SQLModel, table=True):
    __tablename__ = "tenant_ledger_entries"
    __table_args__ = (
        Index("ix_tenant_ledger_entries_admin_id", "admin_id"),
        Index("ix_tenant_ledger_entries_site_id", "site_id"),
        Index("ix_tenant_ledger_entries_order_id", "order_id", unique=True),
        Index("ix_tenant_ledger_entries_razorpay_transfer_id", "razorpay_transfer_id"),
        Index("ix_tenant_ledger_entries_status", "status"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    admin_id: UUID = Field(foreign_key="admins.id", nullable=False)
    site_id: UUID = Field(foreign_key="sites.id", nullable=False)
    order_id: UUID = Field(foreign_key="orders.id", nullable=False)

    gross_amount: Decimal = Field(sa_column=Column(Numeric(12, 2), nullable=False))
    platform_fee_percent: Decimal = Field(
        default=Decimal("3.00"),
        sa_column=Column(Numeric(5, 2), nullable=False),
    )
    platform_fee: Decimal = Field(sa_column=Column(Numeric(12, 2), nullable=False))
    tenant_share: Decimal = Field(sa_column=Column(Numeric(12, 2), nullable=False))
    currency: str = Field(default="INR", max_length=10, nullable=False)

    # status: pending_payout, paid, refunded, held
    status: str = Field(default="pending_payout", max_length=40, nullable=False)
    payout_id: Optional[UUID] = Field(default=None, foreign_key="payouts.id", nullable=True)

    # Razorpay Route Automated Split Transfer tracking
    razorpay_transfer_id: Optional[str] = Field(default=None, max_length=64, nullable=True)
    transfer_status: Optional[str] = Field(default="pending", max_length=30, nullable=True)
    escrow_status: str = Field(default="held", max_length=30, nullable=False)
    escrow_release_due_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    unheld_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    settled_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class Payout(SQLModel, table=True):
    __tablename__ = "payouts"
    __table_args__ = (
        Index("ix_payouts_admin_id", "admin_id"),
        Index("ix_payouts_site_id", "site_id"),
        Index("ix_payouts_status", "status"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    admin_id: UUID = Field(foreign_key="admins.id", nullable=False)
    site_id: UUID = Field(foreign_key="sites.id", nullable=False)

    amount: Decimal = Field(sa_column=Column(Numeric(12, 2), nullable=False))
    currency: str = Field(default="INR", max_length=10, nullable=False)
    status: str = Field(default="processed", max_length=40, nullable=False)
    payout_method: str = Field(default="manual_bank_transfer", max_length=40)
    utr_reference: Optional[str] = Field(default=None, max_length=100)
    notes: Optional[str] = Field(default=None)

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class SupportAgent(SQLModel, table=True):
    __tablename__ = "support_agents"
    __table_args__ = (
        UniqueConstraint("site_id", "email", name="uq_support_agents_site_email"),
        Index("ix_support_agents_site_active", "site_id", "is_active"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True, nullable=False)

    name: str = Field(max_length=255, nullable=False)
    email: str = Field(max_length=255, nullable=False)
    phone: Optional[str] = Field(default=None, max_length=30, nullable=True)
    password_hash: str = Field(max_length=255, nullable=False)
    role: str = Field(default="agent", max_length=50, nullable=False)
    is_active: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True))
    assigned_ticket_count: int = Field(default=0, nullable=False)
    total_resolved_count: int = Field(default=0, nullable=False)

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class SupportTicket(SQLModel, table=True):
    __tablename__ = "support_tickets"
    __table_args__ = (
        Index("ix_support_tickets_status", "status"),
        Index("ix_support_tickets_assigned_agent", "assigned_agent_id"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    ticket_number: str = Field(max_length=40, nullable=False, index=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True, nullable=False)
    customer_id: UUID = Field(foreign_key="users.id", index=True, nullable=False)
    order_id: Optional[UUID] = Field(default=None, foreign_key="orders.id", index=True, nullable=True)
    assigned_agent_id: Optional[UUID] = Field(default=None, foreign_key="support_agents.id", nullable=True)

    category: str = Field(default="other", max_length=50, nullable=False)
    priority: str = Field(default="medium", max_length=30, nullable=False)
    status: str = Field(default="open", max_length=40, nullable=False)

    subject: str = Field(max_length=255, nullable=False)
    order_items_summary: Optional[dict[str, Any]] = Field(default=None, sa_column=Column(JSONB, nullable=True))
    customer_refund_account: Optional[dict[str, Any]] = Field(default=None, sa_column=Column(JSONB, nullable=True))

    resolution_type: Optional[str] = Field(default=None, max_length=50, nullable=True)
    resolution_note: Optional[str] = Field(default=None, nullable=True)
    refund_amount: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(12, 2), nullable=True))

    resolved_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    closed_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class SupportTicketMessage(SQLModel, table=True):
    __tablename__ = "support_ticket_messages"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    ticket_id: UUID = Field(foreign_key="support_tickets.id", index=True, nullable=False)


    sender_type: str = Field(max_length=30, nullable=False)
    sender_id: Optional[UUID] = Field(default=None, nullable=True)
    sender_name: str = Field(max_length=255, nullable=False)

    message: str = Field(nullable=False)
    attachments: Optional[list[str]] = Field(default=None, sa_column=Column(JSONB, nullable=True))
    is_internal_note: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, default=False))

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    read_at: Optional[datetime] = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class StorePage(SQLModel, table=True):
    __tablename__ = "store_pages"
    __table_args__ = (
        UniqueConstraint("site_id", "slug", name="uq_store_pages_site_slug"),
        Index("ix_store_pages_site_slug", "site_id", "slug"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True, nullable=False)

    title: str = Field(max_length=255, nullable=False)
    slug: str = Field(max_length=255, index=True, nullable=False)
    subtitle: Optional[str] = Field(default=None, max_length=500, nullable=True)
    content: str = Field(sa_column=Column(Text, nullable=False, default=""))
    page_type: str = Field(default="custom", max_length=50, nullable=False)  # "about", "contact", "policy", "terms", "story", "custom"

    is_published: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True))
    is_default: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, default=False))

    # SEO metadata
    meta_title: Optional[str] = Field(default=None, max_length=255, nullable=True)
    meta_description: Optional[str] = Field(default=None, max_length=1000, nullable=True)

    # Contact details for contact/business pages
    contact_email: Optional[str] = Field(default=None, max_length=255, nullable=True)
    contact_phone: Optional[str] = Field(default=None, max_length=100, nullable=True)
    contact_address: Optional[str] = Field(default=None, max_length=500, nullable=True)
    contact_hours: Optional[str] = Field(default=None, max_length=255, nullable=True)

    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=utc_now,
        ),
    )


class SiteTrafficEvent(SQLModel, table=True):
    __tablename__ = "site_traffic_events"
    __table_args__ = (
        Index("ix_traffic_site_created", "site_id", "created_at"),
        Index("ix_traffic_site_session", "site_id", "session_hash"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True, nullable=False)
    session_hash: str = Field(max_length=64, index=True, nullable=False)
    page_path: str = Field(default="/", max_length=500, nullable=False)
    referrer_source: str = Field(default="Direct", max_length=100, nullable=False)
    device_type: str = Field(default="Desktop", max_length=50, nullable=False)
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), index=True, nullable=False),
    )


class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_site_created", "site_id", "created_at"),
        Index("ix_audit_category_created", "category", "created_at"),
        Index("ix_audit_actor_created", "actor_email", "created_at"),
        Index("ix_audit_actor_type_created", "actor_type", "created_at"),
        Index("ix_audit_source_created", "source", "created_at"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: Optional[UUID] = Field(default=None, foreign_key="sites.id", nullable=True, index=True)
    admin_id: Optional[UUID] = Field(default=None, foreign_key="admins.id", nullable=True, index=True)
    actor_type: str = Field(default="USER", index=True)  # USER, OWNER, TEAM_MEMBER, RIDER, SHIPROCKET, PAYMENT_PROVIDER, SYSTEM, CRON_JOB, AI, etc.
    source: str = Field(default="web_app", index=True)  # web_app, rider_app, webhook_razorpay, webhook_shiprocket, background_worker, cron, ai_agent
    actor_email: Optional[str] = Field(default=None, index=True)
    actor_name: Optional[str] = Field(default=None)
    actor_role: Optional[str] = Field(default=None)
    action: str = Field(index=True)  # e.g. "order.status_changed", "product.price_changed", "rider.delivered"
    category: str = Field(default="general", index=True)
    description: str = Field(nullable=False)
    ip_address: Optional[str] = Field(default=None)
    user_agent: Optional[str] = Field(default=None)
    resource_type: Optional[str] = Field(default=None, index=True)
    resource_id: Optional[str] = Field(default=None, index=True)
    resource_name: Optional[str] = Field(default=None)
    summary: Optional[str] = Field(default=None)
    request_id: Optional[str] = Field(default=None)
    correlation_id: Optional[str] = Field(default=None, index=True)
    idempotency_key: Optional[str] = Field(default=None, index=True)
    status: str = Field(default="success")  # "success" | "warning" | "failure" | "partial" | "reversed"
    details: Optional[dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), index=True, nullable=False),
    )


class SiteDomain(SQLModel, table=True):
    __tablename__ = "site_domains"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True, nullable=False)

    domain: str = Field(index=True, unique=True, nullable=False)
    is_primary: bool = Field(default=False, nullable=False)
    domain_type: str = Field(default="custom_subdomain", nullable=False)  # custom_subdomain | custom_www

    status: str = Field(default="dns_required", nullable=False)
    ssl_status: str = Field(default="ssl_pending", nullable=False)

    dns_record_type: str = Field(default="CNAME", nullable=False)
    dns_record_name: str = Field(nullable=False)
    dns_record_value: str = Field(nullable=False)

    verification_token: str = Field(nullable=False)
    last_verified_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))

    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, onupdate=utc_now))


class DomainOperation(SQLModel, table=True):
    __tablename__ = "domain_operations"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    domain_id: UUID = Field(foreign_key="site_domains.id", index=True, nullable=False)
    site_id: UUID = Field(foreign_key="sites.id", index=True, nullable=False)

    operation_type: str = Field(nullable=False)  # REGISTER_DOMAIN, REMOVE_DOMAIN, VERIFY_DNS, CHECK_SSL, PURGE_CACHE
    idempotency_key: str = Field(index=True, unique=True, nullable=False)
    status: str = Field(default="pending", nullable=False)  # pending, in_progress, completed, failed, uncertain
    attempt_count: int = Field(default=0, nullable=False)
    last_error: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    provider_reference: Optional[str] = Field(default=None, nullable=True)

    next_retry_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False, onupdate=utc_now))


class ProcessedProviderEvent(SQLModel, table=True):
    __tablename__ = "processed_provider_events"
    __table_args__ = (
        UniqueConstraint("provider", "event_id", name="uq_provider_event_id"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    provider: str = Field(nullable=False)
    event_id: str = Field(nullable=False)

    resource_id: Optional[str] = Field(default=None, nullable=True)
    payload_hash: str = Field(nullable=False)
    status: str = Field(default="processed", nullable=False)

    received_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))
    processed_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))


class SiteSlugHistory(SQLModel, table=True):
    __tablename__ = "site_slug_history"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    site_id: UUID = Field(foreign_key="sites.id", index=True, nullable=False)
    old_slug: str = Field(index=True, unique=True, nullable=False)
    reserved_until: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    created_at: datetime = Field(default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False))
