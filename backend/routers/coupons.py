from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from auth_middleware import check_admin_has_permission, enforce_site_ownership
from db.database import get_session
from models import Coupon, CouponUsage, Order, Site, User, Collection, Category, Product, ProductCollection
from services.audit_service import AuditService, ActorType, SourceType, AuditCategory

router = APIRouter(prefix="/coupons", tags=["coupons"])


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def resolve_site(site_identifier: str, session: Session) -> Site:
    site = None
    try:
        site_uuid = UUID(site_identifier)
        site = session.get(Site, site_uuid)
    except Exception:
        pass

    if not site:
        site = session.exec(
            select(Site).where(Site.slug == site_identifier.lower().strip())
        ).first()

    if not site:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Store not found",
        )
    return site


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CreateCouponRequest(BaseModel):
    code: str = Field(..., min_length=2, max_length=50)
    description: Optional[str] = ""
    discount_type: str = Field("percentage", pattern="^(percentage|fixed_amount|free_shipping)$")
    discount_value: Decimal = Field(default=Decimal("0.00"), ge=0)
    max_discount_amount: Optional[Decimal] = Field(default=None, ge=0)
    applies_to: str = Field(default="all", pattern="^(all|collections|categories)$")
    collection_ids: list[str] = Field(default_factory=list)
    category_ids: list[str] = Field(default_factory=list)
    min_order_value: Decimal = Field(default=Decimal("0.00"), ge=0)
    is_first_order_only: bool = False
    total_usage_limit: Optional[int] = Field(default=None, ge=1)
    per_customer_limit: int = Field(default=1, ge=1)
    starts_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    is_active: bool = True
    is_public: bool = True


class UpdateCouponRequest(BaseModel):
    description: Optional[str] = None
    discount_type: Optional[str] = None
    discount_value: Optional[Decimal] = None
    max_discount_amount: Optional[Decimal] = None
    applies_to: Optional[str] = None
    collection_ids: Optional[list[str]] = None
    category_ids: Optional[list[str]] = None
    min_order_value: Optional[Decimal] = None
    is_first_order_only: Optional[bool] = None
    total_usage_limit: Optional[int] = None
    per_customer_limit: Optional[int] = None
    starts_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    is_active: Optional[bool] = None
    is_public: Optional[bool] = None


class ValidateCouponRequest(BaseModel):
    code: str
    subtotal: Decimal = Field(..., ge=0)
    delivery_fee: Decimal = Field(default=Decimal("0.00"), ge=0)
    customer_email: Optional[str] = None
    cart_items: Optional[list[dict[str, Any]]] = None


def serialize_coupon(coupon: Coupon, total_savings: Decimal = Decimal("0.00")) -> dict[str, Any]:
    return {
        "id": str(coupon.id),
        "siteId": str(coupon.site_id),
        "code": coupon.code,
        "description": coupon.description,
        "discountType": coupon.discount_type,
        "discountValue": float(coupon.discount_value),
        "maxDiscountAmount": float(coupon.max_discount_amount) if coupon.max_discount_amount is not None else None,
        "appliesTo": getattr(coupon, "applies_to", "all") or "all",
        "collectionIds": [str(cid) for cid in (getattr(coupon, "collection_ids", []) or [])],
        "categoryIds": [str(cid) for cid in (getattr(coupon, "category_ids", []) or [])],
        "minOrderValue": float(coupon.min_order_value),
        "isFirstOrderOnly": coupon.is_first_order_only,
        "totalUsageLimit": coupon.total_usage_limit,
        "timesUsed": coupon.times_used,
        "perCustomerLimit": coupon.per_customer_limit,
        "startsAt": coupon.starts_at.isoformat() if coupon.starts_at else None,
        "expiresAt": coupon.expires_at.isoformat() if coupon.expires_at else None,
        "isActive": coupon.is_active,
        "isPublic": getattr(coupon, "is_public", True),
        "totalSavings": float(total_savings),
        "createdAt": coupon.created_at.isoformat(),
        "updatedAt": coupon.updated_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# Admin Endpoints
# ---------------------------------------------------------------------------

@router.get("/admin/{site_id}")
def admin_list_coupons(
    site_id: str,
    admin=Depends(enforce_site_ownership),
    session: Session = Depends(get_session),
):
    site = resolve_site(site_id, session)
    coupons = session.exec(
        select(Coupon)
        .where(Coupon.site_id == site.id)
        .order_by(Coupon.created_at.desc())
    ).all()

    # Aggregate savings per coupon from coupon_usages
    usages = session.exec(
        select(
            CouponUsage.coupon_id,
            func.sum(CouponUsage.discount_amount).label("total_savings"),
        )
        .where(CouponUsage.site_id == site.id)
        .group_by(CouponUsage.coupon_id)
    ).all()
    savings_map = {u[0]: Decimal(str(u[1] or 0)) for u in usages}

    total_active = sum(1 for c in coupons if c.is_active)
    total_redemptions = sum(c.times_used for c in coupons)
    total_store_savings = sum(savings_map.values(), Decimal("0.00"))

    return {
        "coupons": [serialize_coupon(c, savings_map.get(c.id, Decimal("0.00"))) for c in coupons],
        "stats": {
            "totalCoupons": len(coupons),
            "activeCoupons": total_active,
            "totalRedemptions": total_redemptions,
            "totalSavings": float(total_store_savings),
        },
    }


@router.post("/admin/{site_id}")
def admin_create_coupon(
    site_id: str,
    payload: CreateCouponRequest,
    admin=Depends(enforce_site_ownership),
    session: Session = Depends(get_session),
):
    admin_id = admin.get("adminId") if isinstance(admin, dict) else None
    if admin_id and not check_admin_has_permission(admin_id, "discounts:create", session):
        raise HTTPException(status_code=403, detail="You do not have permission to create promo codes")

    site = resolve_site(site_id, session)
    clean_code = payload.code.strip().upper()

    # Check if coupon code already exists for this site
    existing = session.exec(
        select(Coupon).where(
            Coupon.site_id == site.id,
            Coupon.code == clean_code,
        )
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Promo code '{clean_code}' already exists for this store.",
        )

    coupon = Coupon(
        site_id=site.id,
        code=clean_code,
        description=payload.description or "",
        discount_type=payload.discount_type,
        discount_value=payload.discount_value,
        max_discount_amount=payload.max_discount_amount,
        applies_to=payload.applies_to or "all",
        collection_ids=payload.collection_ids or [],
        category_ids=payload.category_ids or [],
        min_order_value=payload.min_order_value,
        is_first_order_only=payload.is_first_order_only,
        total_usage_limit=payload.total_usage_limit,
        per_customer_limit=payload.per_customer_limit,
        starts_at=payload.starts_at or utc_now(),
        expires_at=payload.expires_at,
        is_active=payload.is_active,
        is_public=payload.is_public,
    )
    session.add(coupon)
    session.commit()
    session.refresh(coupon)

    try:
        admin_uuid = UUID(str(admin_id)) if admin_id else None
        AuditService.log_event(
            site_id=site.id,
            actor_type=ActorType.OWNER if (admin.get("role") or "").lower() == "owner" else ActorType.TEAM_MEMBER,
            actor_id=admin_uuid,
            actor_name=admin.get("name"),
            actor_email=admin.get("email"),
            actor_role=admin.get("role") or "Staff",
            category=AuditCategory.DISCOUNTS,
            action="coupon.created",
            source=SourceType.WEB_ADMIN,
            resource_type="coupon",
            resource_id=str(coupon.id),
            resource_name=coupon.code,
            summary=f"Created promo code '{coupon.code}' ({coupon.discount_type}: {coupon.discount_value})",
            metadata={
                "code": coupon.code,
                "discount_type": coupon.discount_type,
                "discount_value": float(coupon.discount_value),
                "min_order_value": float(coupon.min_order_value),
            },
        )
    except Exception as log_err:
        pass

    return {
        "message": f"Promo code '{coupon.code}' created successfully.",
        "coupon": serialize_coupon(coupon),
    }


@router.put("/admin/{site_id}/{coupon_id}")
def admin_update_coupon(
    site_id: str,
    coupon_id: str,
    payload: UpdateCouponRequest,
    admin=Depends(enforce_site_ownership),
    session: Session = Depends(get_session),
):
    admin_id = admin.get("adminId") if isinstance(admin, dict) else None
    if admin_id and not check_admin_has_permission(admin_id, "discounts:edit", session):
        raise HTTPException(status_code=403, detail="You do not have permission to edit promo codes")

    site = resolve_site(site_id, session)
    coupon_uuid = UUID(coupon_id)
    coupon = session.get(Coupon, coupon_uuid)
    if not coupon or coupon.site_id != site.id:
        raise HTTPException(status_code=404, detail="Coupon not found")

    if payload.description is not None:
        coupon.description = payload.description
    if payload.discount_type is not None:
        coupon.discount_type = payload.discount_type
    if payload.discount_value is not None:
        coupon.discount_value = payload.discount_value
    if payload.max_discount_amount is not None:
        coupon.max_discount_amount = payload.max_discount_amount
    if payload.applies_to is not None:
        coupon.applies_to = payload.applies_to
    if payload.collection_ids is not None:
        coupon.collection_ids = payload.collection_ids
    if payload.category_ids is not None:
        coupon.category_ids = payload.category_ids
    if payload.min_order_value is not None:
        coupon.min_order_value = payload.min_order_value
    if payload.is_first_order_only is not None:
        coupon.is_first_order_only = payload.is_first_order_only
    if payload.total_usage_limit is not None:
        coupon.total_usage_limit = payload.total_usage_limit
    if payload.per_customer_limit is not None:
        coupon.per_customer_limit = payload.per_customer_limit
    if payload.starts_at is not None:
        coupon.starts_at = payload.starts_at
    if payload.expires_at is not None:
        coupon.expires_at = payload.expires_at
    if payload.is_active is not None:
        coupon.is_active = payload.is_active
    if payload.is_public is not None:
        coupon.is_public = payload.is_public

    coupon.updated_at = utc_now()
    session.add(coupon)
    session.commit()
    session.refresh(coupon)

    try:
        admin_uuid = UUID(str(admin_id)) if admin_id else None
        AuditService.log_event(
            site_id=site.id,
            actor_type=ActorType.OWNER if (admin.get("role") or "").lower() == "owner" else ActorType.TEAM_MEMBER,
            actor_id=admin_uuid,
            actor_name=admin.get("name"),
            actor_email=admin.get("email"),
            actor_role=admin.get("role") or "Staff",
            category=AuditCategory.DISCOUNTS,
            action="coupon.updated",
            source=SourceType.WEB_ADMIN,
            resource_type="coupon",
            resource_id=str(coupon.id),
            resource_name=coupon.code,
            summary=f"Updated promo code '{coupon.code}' details",
            metadata={"code": coupon.code, "is_active": coupon.is_active},
        )
    except Exception as log_err:
        pass

    return {
        "message": "Coupon updated successfully",
        "coupon": serialize_coupon(coupon),
    }


@router.patch("/admin/{site_id}/{coupon_id}/toggle")
def admin_toggle_coupon(
    site_id: str,
    coupon_id: str,
    admin=Depends(enforce_site_ownership),
    session: Session = Depends(get_session),
):
    admin_id = admin.get("adminId") if isinstance(admin, dict) else None
    if admin_id and not check_admin_has_permission(admin_id, "discounts:edit", session):
        raise HTTPException(status_code=403, detail="You do not have permission to edit promo codes")

    site = resolve_site(site_id, session)
    coupon_uuid = UUID(coupon_id)
    coupon = session.get(Coupon, coupon_uuid)
    if not coupon or coupon.site_id != site.id:
        raise HTTPException(status_code=404, detail="Coupon not found")

    coupon.is_active = not coupon.is_active
    coupon.updated_at = utc_now()
    session.add(coupon)
    session.commit()
    session.refresh(coupon)

    try:
        admin_uuid = UUID(str(admin_id)) if admin_id else None
        AuditService.log_event(
            site_id=site.id,
            actor_type=ActorType.OWNER if (admin.get("role") or "").lower() == "owner" else ActorType.TEAM_MEMBER,
            actor_id=admin_uuid,
            actor_name=admin.get("name"),
            actor_email=admin.get("email"),
            actor_role=admin.get("role") or "Staff",
            category=AuditCategory.DISCOUNTS,
            action="coupon.toggled",
            source=SourceType.WEB_ADMIN,
            resource_type="coupon",
            resource_id=str(coupon.id),
            resource_name=coupon.code,
            summary=f"Promo code '{coupon.code}' is now {'active' if coupon.is_active else 'paused'}",
            metadata={"code": coupon.code, "is_active": coupon.is_active},
        )
    except Exception as log_err:
        pass

    return {
        "message": f"Coupon '{coupon.code}' is now {'active' if coupon.is_active else 'paused'}.",
        "coupon": serialize_coupon(coupon),
    }


@router.delete("/admin/{site_id}/{coupon_id}")
def admin_delete_coupon(
    site_id: str,
    coupon_id: str,
    admin=Depends(enforce_site_ownership),
    session: Session = Depends(get_session),
):
    admin_id = admin.get("adminId") if isinstance(admin, dict) else None
    if admin_id and not check_admin_has_permission(admin_id, "discounts:delete", session):
        raise HTTPException(status_code=403, detail="You do not have permission to delete promo codes")

    site = resolve_site(site_id, session)
    coupon_uuid = UUID(coupon_id)
    coupon = session.get(Coupon, coupon_uuid)
    if not coupon or coupon.site_id != site.id:
        raise HTTPException(status_code=404, detail="Coupon not found")

    coupon_code = coupon.code
    session.delete(coupon)
    session.commit()

    try:
        admin_uuid = UUID(str(admin_id)) if admin_id else None
        AuditService.log_event(
            site_id=site.id,
            actor_type=ActorType.OWNER if (admin.get("role") or "").lower() == "owner" else ActorType.TEAM_MEMBER,
            actor_id=admin_uuid,
            actor_name=admin.get("name"),
            actor_email=admin.get("email"),
            actor_role=admin.get("role") or "Staff",
            category=AuditCategory.DISCOUNTS,
            action="coupon.deleted",
            source=SourceType.WEB_ADMIN,
            resource_type="coupon",
            resource_id=coupon_id,
            resource_name=coupon_code,
            summary=f"Deleted promo code '{coupon_code}'",
            metadata={"code": coupon_code},
        )
    except Exception as log_err:
        pass

    return {"message": f"Coupon '{coupon.code}' deleted successfully."}


# ---------------------------------------------------------------------------
# Storefront Public Available Coupons Endpoint
# ---------------------------------------------------------------------------

@router.get("/available/{site_id}")
def get_available_storefront_coupons(
    site_id: str,
    session: Session = Depends(get_session),
):
    site = resolve_site(site_id, session)
    now = utc_now()

    coupons = session.exec(
        select(Coupon)
        .where(
            Coupon.site_id == site.id,
            Coupon.is_active == True,
            Coupon.is_public == True,
        )
        .order_by(Coupon.created_at.desc())
    ).all()

    valid_available = []
    for c in coupons:
        if c.starts_at and now < c.starts_at:
            continue
        if c.expires_at and now > c.expires_at:
            continue
        if c.total_usage_limit is not None and c.times_used >= c.total_usage_limit:
            continue
        valid_available.append({
            "id": str(c.id),
            "code": c.code,
            "description": c.description,
            "discountType": c.discount_type,
            "discountValue": float(c.discount_value),
            "maxDiscountAmount": float(c.max_discount_amount) if c.max_discount_amount is not None else None,
            "appliesTo": getattr(c, "applies_to", "all") or "all",
            "collectionIds": [str(cid) for cid in (getattr(c, "collection_ids", []) or [])],
            "categoryIds": [str(cid) for cid in (getattr(c, "category_ids", []) or [])],
            "minOrderValue": float(c.min_order_value),
            "isFirstOrderOnly": c.is_first_order_only,
            "expiresAt": c.expires_at.isoformat() if c.expires_at else None,
        })

    return {"coupons": valid_available}


# ---------------------------------------------------------------------------
# Storefront Customer Validation Endpoint
# ---------------------------------------------------------------------------

def evaluate_coupon_targeting(
    coupon: Coupon,
    subtotal: Decimal,
    delivery_fee: Decimal,
    cart_items: Optional[list[dict[str, Any]]],
    session: Session,
) -> tuple[bool, str, Decimal, Decimal]:
    applies_to = getattr(coupon, "applies_to", "all") or "all"
    col_ids = [str(c).strip() for c in (getattr(coupon, "collection_ids", []) or []) if str(c).strip()]
    cat_ids = [str(c).strip() for c in (getattr(coupon, "category_ids", []) or []) if str(c).strip()]

    # Case 1: Applies to All Products
    if applies_to == "all" or (not col_ids and not cat_ids):
        qualifying_subtotal = subtotal
        discount_amount = _calculate_discount(coupon, qualifying_subtotal, delivery_fee)
        return True, "", qualifying_subtotal, discount_amount

    # If targeted to collections or categories, cart_items must be provided
    if not cart_items:
        return False, f"Promo code '{coupon.code}' is only valid for specific products. Please add qualifying items to your cart.", Decimal("0.00"), Decimal("0.00")

    # Extract all product UUIDs and line totals from cart items
    item_product_map: list[tuple[UUID, Decimal]] = []
    for itm in cart_items:
        raw_pid = itm.get("product_id") or itm.get("productId") or itm.get("id")
        if not raw_pid:
            continue
        try:
            pid = UUID(str(raw_pid))
            qty = Decimal(str(itm.get("quantity") or 1))
            unit_price = Decimal(str(itm.get("price") or itm.get("unit_price") or 0))
            line_total = Decimal(str(itm.get("line_total") or itm.get("subtotal") or (qty * unit_price)))
            item_product_map.append((pid, line_total))
        except Exception:
            continue

    prod_uuids = [p[0] for p in item_product_map]
    if not prod_uuids:
        return False, f"No qualifying items found in cart for promo code '{coupon.code}'.", Decimal("0.00"), Decimal("0.00")

    qualifying_pids = set()

    # Case 2: Specific Collections
    if applies_to == "collections" and col_ids:
        col_uuids = []
        for c in col_ids:
            try:
                col_uuids.append(UUID(c))
            except Exception:
                pass
        if col_uuids:
            matching_rows = session.exec(
                select(ProductCollection.product_id).where(
                    ProductCollection.product_id.in_(prod_uuids),
                    ProductCollection.collection_id.in_(col_uuids),
                )
            ).all()
            qualifying_pids = set(matching_rows)

        if not qualifying_pids:
            col_names = session.exec(
                select(Collection.name).where(Collection.id.in_(col_uuids))
            ).all()
            names_str = ", ".join(col_names) if col_names else "selected collections"
            return False, f"Promo code '{coupon.code}' is only valid for items in collection(s): {names_str}.", Decimal("0.00"), Decimal("0.00")

    # Case 3: Specific Categories
    elif applies_to == "categories" and cat_ids:
        cat_uuids = []
        cat_names_raw = set()
        for c in cat_ids:
            try:
                cat_uuids.append(UUID(c))
            except Exception:
                cat_names_raw.add(c.lower().strip())

        matching_products = session.exec(
            select(Product).where(Product.id.in_(prod_uuids))
        ).all()

        for p in matching_products:
            if (p.category_id and p.category_id in cat_uuids) or (p.category and p.category.lower().strip() in cat_names_raw):
                qualifying_pids.add(p.id)

        if not qualifying_pids:
            cat_names = []
            if cat_uuids:
                cat_names.extend(session.exec(select(Category.name).where(Category.id.in_(cat_uuids))).all())
            cat_names.extend(list(cat_names_raw))
            names_str = ", ".join(cat_names) if cat_names else "selected categories"
            return False, f"Promo code '{coupon.code}' is only valid for items in category: {names_str}.", Decimal("0.00"), Decimal("0.00")

    qualifying_subtotal = Decimal("0.00")
    for pid, line_total in item_product_map:
        if pid in qualifying_pids:
            qualifying_subtotal += line_total

    if qualifying_subtotal <= Decimal("0.00"):
        return False, f"No qualifying items found in cart for promo code '{coupon.code}'.", Decimal("0.00"), Decimal("0.00")

    discount_amount = _calculate_discount(coupon, qualifying_subtotal, delivery_fee)
    return True, "", qualifying_subtotal, discount_amount


def _calculate_discount(coupon: Coupon, base_amount: Decimal, delivery_fee: Decimal) -> Decimal:
    discount_amount = Decimal("0.00")
    if coupon.discount_type == "percentage":
        computed = (base_amount * coupon.discount_value) / Decimal("100.00")
        if coupon.max_discount_amount is not None and coupon.max_discount_amount > 0:
            computed = min(computed, coupon.max_discount_amount)
        discount_amount = min(computed, base_amount)
    elif coupon.discount_type == "fixed_amount":
        discount_amount = min(coupon.discount_value, base_amount)
    elif coupon.discount_type == "free_shipping":
        discount_amount = delivery_fee
    return discount_amount


@router.post("/validate/{site_id}")
def validate_storefront_coupon(
    site_id: str,
    payload: ValidateCouponRequest,
    session: Session = Depends(get_session),
):
    site = resolve_site(site_id, session)
    clean_code = payload.code.strip().upper()

    if not clean_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please enter a promo code.",
        )

    coupon = session.exec(
        select(Coupon).where(
            Coupon.site_id == site.id,
            Coupon.code == clean_code,
        )
    ).first()

    if not coupon:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Promo code '{clean_code}' is invalid.",
        )

    if not coupon.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Promo code '{clean_code}' is currently inactive.",
        )

    now = utc_now()
    if coupon.starts_at and now < coupon.starts_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Promo code '{clean_code}' is not active yet.",
        )

    if coupon.expires_at and now > coupon.expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Promo code '{clean_code}' has expired.",
        )

    if coupon.total_usage_limit is not None and coupon.times_used >= coupon.total_usage_limit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Promo code '{clean_code}' has reached its maximum total usage limit.",
        )

    subtotal = payload.subtotal
    if subtotal < coupon.min_order_value:
        diff = coupon.min_order_value - subtotal
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Minimum order amount of ₹{coupon.min_order_value:,.2f} required for this code. Add ₹{diff:,.2f} more to apply.",
        )

    customer_email = (payload.customer_email or "").strip().lower()

    if customer_email:
        # First order only rule
        if coupon.is_first_order_only:
            past_order = session.exec(
                select(Order)
                .join(User, Order.customer_id == User.id)
                .where(
                    Order.site_id == site.id,
                    User.email == customer_email,
                    Order.status != "cancelled",
                )
            ).first()
            if past_order:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Promo code '{clean_code}' is only valid for your first order.",
                )

        # Per-customer limit
        if coupon.per_customer_limit:
            usage_count = session.exec(
                select(func.count(CouponUsage.id)).where(
                    CouponUsage.site_id == site.id,
                    CouponUsage.coupon_id == coupon.id,
                    CouponUsage.customer_email == customer_email,
                )
            ).one()
            if usage_count >= coupon.per_customer_limit:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"You have already used promo code '{clean_code}' the maximum allowed number of times ({coupon.per_customer_limit}).",
                )

    # Evaluate targeting and compute discount
    is_eligible, err_msg, qualifying_subtotal, discount_amount = evaluate_coupon_targeting(
        coupon=coupon,
        subtotal=subtotal,
        delivery_fee=payload.delivery_fee,
        cart_items=payload.cart_items,
        session=session,
    )

    if not is_eligible:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=err_msg or f"Promo code '{clean_code}' is not applicable to the items in your cart.",
        )

    discount_amount = round(discount_amount, 2)
    final_subtotal = max(Decimal("0.00"), subtotal - discount_amount)
    final_total = max(Decimal("0.00"), final_subtotal + payload.delivery_fee)

    return {
        "valid": True,
        "coupon": {
            "id": str(coupon.id),
            "code": coupon.code,
            "discountType": coupon.discount_type,
            "discountValue": float(coupon.discount_value),
            "discountAmount": float(discount_amount),
            "appliesTo": getattr(coupon, "applies_to", "all") or "all",
            "qualifyingSubtotal": float(qualifying_subtotal),
            "description": coupon.description,
        },
        "discountAmount": float(discount_amount),
        "qualifyingSubtotal": float(qualifying_subtotal),
        "finalSubtotal": float(final_subtotal),
        "finalTotal": float(final_total),
        "message": f"Promo code '{coupon.code}' applied successfully! You saved ₹{discount_amount:,.2f}.",
    }
