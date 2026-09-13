from __future__ import annotations

import logging
import math
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import cast, String
from sqlmodel import Session, delete, func, or_, select

from auth_middleware import authenticate_admin, authenticate_customer, check_admin_has_permission, enforce_site_ownership
from db.database import get_session
from routers.audit_logs import log_activity

logger = logging.getLogger(__name__)
from models import (
    Cart,
    CartItem,
    Category,
    Collection,
    Coupon,
    CouponUsage,
    DeliveryAgent,
    DeliverySettings,
    InventoryMovement,
    Order,
    OrderItem,
    OrderStatusHistory,
    Product,
    ProductCollection,
    Shipment,
    Site,
    TenantLedgerEntry,
    User,
    UserAddress,
)
from services.shiprocket import ShiprocketClient

router = APIRouter(
    prefix="/orders",
    tags=["orders"],
)

ORDER_STATUSES = {
    "placed",
    "confirmed",
    "shipped",
    "out_for_delivery",
    "delivered",
    "partially_cancelled",
    "cancelled",
}

PAYMENT_NORMALIZATION = {
    "cod": "cod",
    "cash_on_delivery": "cod",
    "upi": "upi",
    "card": "card",
    "credit_card": "card",
    "debit_card": "card",
    "netbanking": "netbanking",
    "wallet": "wallet",
    "razorpay": "razorpay",
    "online": "online",
}


def get_effective_payment_status(order: Order) -> str:
    status = (getattr(order, "payment_status", None) or "pending").lower()
    method = (getattr(order, "payment_method", None) or "").lower()
    if method in ("cod", "cash_on_delivery") and order.status == "delivered" and status == "pending":
        return "paid"
    return status

ALLOWED_STATUS_TRANSITIONS = {
    "placed": {"confirmed", "shipped", "cancelled"},
    "confirmed": {"shipped", "out_for_delivery", "delivered", "cancelled"},
    "shipped": {"out_for_delivery", "delivered", "cancelled", "rescheduled"},
    "out_for_delivery": {"delivered", "rescheduled", "failed", "cancelled"},
    "rescheduled": {"out_for_delivery", "shipped", "delivered", "failed", "cancelled"},
    "failed": {"rescheduled", "shipped", "delivered", "cancelled"},
    "delivered": set(),
    "partially_cancelled": set(),
    "cancelled": set(),
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def money(value: Decimal | float | int | str) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def get_site_or_404(session: Session, site_id: UUID) -> Site:
    site = session.get(Site, site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    return site


def get_user_for_site_or_404(session: Session, site_id: UUID, user_id: UUID) -> User:
    user = session.get(User, user_id)
    if not user or user.site_id != site_id:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def get_cart_for_user_or_404(session: Session, site_id: UUID, user_id: UUID) -> Cart:
    cart = session.exec(
        select(Cart).where(Cart.site_id == site_id, Cart.user_id == user_id)
    ).first()
    if not cart:
        raise HTTPException(status_code=400, detail="Cart not found")
    return cart


def get_address_for_user_or_404(
    session: Session,
    site_id: UUID,
    user_id: UUID,
    address_id: UUID,
) -> UserAddress:
    address = session.get(UserAddress, address_id)
    if (
        not address
        or address.site_id != site_id
        or address.user_id != user_id
        or not address.is_active
    ):
        raise HTTPException(status_code=404, detail="Address not found")
    return address


def normalize_payment_method(value: str) -> str:
    key = str(value or "").strip().lower().replace(" ", "_")
    if not key:
        raise HTTPException(status_code=400, detail="Payment method is required")
    return PAYMENT_NORMALIZATION.get(key, key)


def to_number(value: Any) -> Decimal:
    try:
        return money(value or 0)
    except Exception:
        return Decimal("0.00")


def serialize_address_snapshot(address: UserAddress) -> dict[str, Any]:
    return {
        "id": str(address.id),
        "fullName": address.full_name,
        "full_name": address.full_name,
        "mobileNumber": address.mobile_number,
        "mobile_number": address.mobile_number,
        "addressLine1": address.address_line1,
        "address_line1": address.address_line1,
        "city": address.city,
        "postalCode": address.postal_code,
        "postal_code": address.postal_code,
        "email": address.email,
        "addressType": address.address_type,
        "address_type": address.address_type,
        "latitude": getattr(address, "latitude", None),
        "longitude": getattr(address, "longitude", None),
        "geoAccuracy": getattr(address, "geo_accuracy", None),
        "geo_accuracy": getattr(address, "geo_accuracy", None),
    }


def get_effective_shipping_address(order: Order, session: Optional[Session] = None) -> dict[str, Any]:
    """Retrieve or self-heal the shipping address snapshot for an order."""
    addr = order.shipping_address if isinstance(order.shipping_address, dict) else {}
    has_full_address = bool(
        (addr.get("addressLine1") or addr.get("address_line1") or addr.get("address") or addr.get("street") or addr.get("line1"))
        and (addr.get("city") or addr.get("postalCode") or addr.get("pincode"))
    )
    if has_full_address:
        return addr

    if not session:
        return addr

    # 1. Fallback to order.shipping_address_id
    if getattr(order, "shipping_address_id", None):
        user_addr = session.get(UserAddress, order.shipping_address_id)
        if user_addr:
            snapshot = serialize_address_snapshot(user_addr)
            merged = {**snapshot, **{k: v for k, v in addr.items() if v}}
            order.shipping_address = merged
            session.add(order)
            try:
                session.commit()
            except Exception:
                session.rollback()
            return merged

    # 2. Fallback to customer's saved address in UserAddress
    if getattr(order, "customer_id", None):
        user_addr = session.exec(
            select(UserAddress)
            .where(UserAddress.user_id == order.customer_id)
            .order_by(UserAddress.is_default.desc(), UserAddress.created_at.desc())
        ).first()
        if user_addr:
            snapshot = serialize_address_snapshot(user_addr)
            merged = {**snapshot, **{k: v for k, v in addr.items() if v}}
            order.shipping_address = merged
            session.add(order)
            try:
                session.commit()
            except Exception:
                session.rollback()
            return merged

        # 3. Fallback to User profile
        user = session.get(User, order.customer_id)
        if user:
            snapshot = {
                "fullName": user.name or addr.get("fullName") or "Customer",
                "full_name": user.name or addr.get("fullName") or "Customer",
                "mobileNumber": user.phone or addr.get("mobileNumber") or "",
                "mobile_number": user.phone or addr.get("mobileNumber") or "",
                "email": user.email or addr.get("email") or "",
                "addressLine1": addr.get("addressLine1") or "",
                "city": addr.get("city") or "",
                "postalCode": addr.get("postalCode") or "",
            }
            merged = {**snapshot, **{k: v for k, v in addr.items() if v}}
            order.shipping_address = merged
            session.add(order)
            try:
                session.commit()
            except Exception:
                session.rollback()
            return merged

    return addr


import secrets


def ensure_order_delivery_otp(order: Order, session: Optional[Session] = None) -> str:
    """Generate a stable 4-digit Delivery OTP and persist to database if not already assigned."""
    if not getattr(order, "delivery_otp", None):
        order.delivery_otp = f"{secrets.randbelow(9000) + 1000}"
        if session:
            session.add(order)
            try:
                session.commit()
                session.refresh(order)
            except Exception:
                session.rollback()
    return str(order.delivery_otp)


def serialize_shipment(
    shipment: Optional[Shipment],
    order_status: Optional[str] = None,
    session: Optional[Session] = None,
    is_admin: bool = False,
) -> Optional[dict[str, Any]]:
    if not shipment:
        return None
    agent_id_str = str(shipment.agent_id) if getattr(shipment, "agent_id", None) else None
    agent_token = getattr(shipment, "agent_token", None)

    effective_status = shipment.status
    if order_status in ("delivered", "returned") and shipment.status not in ("delivered", "returned"):
        effective_status = "delivered"
    elif order_status == "cancelled" and shipment.status != "cancelled":
        effective_status = "cancelled"
    elif order_status == "out_for_delivery" and shipment.status not in ("out_for_delivery", "delivered"):
        effective_status = "out_for_delivery"

    delivery_partner_name = shipment.delivery_partner_name
    delivery_partner_phone = shipment.delivery_partner_phone
    vehicle_type = None

    if shipment.agent_id and session:
        agent = session.get(DeliveryAgent, shipment.agent_id)
        if agent:
            if not delivery_partner_name:
                delivery_partner_name = agent.name
            if not delivery_partner_phone:
                delivery_partner_phone = agent.phone
            vehicle_type = getattr(agent, "vehicle_type", "bike")

    mode_str = getattr(shipment, "delivery_mode", None) or getattr(shipment, "mode", None)
    has_agent = bool(shipment.agent_id) or (bool(delivery_partner_name) and mode_str != "manual" and not getattr(shipment, "awb_number", None))

    is_own_agent = bool(mode_str == "own_agent" or has_agent)
    is_shiprocket = bool(
        not is_own_agent and (
            mode_str == "shiprocket"
            or (bool(getattr(shipment, "awb_number", None)) and not delivery_partner_name)
            or (bool(getattr(shipment, "courier_name", None)) and not delivery_partner_name)
        )
    )
    is_manual = bool(not is_own_agent and not is_shiprocket)

    scans: list[dict[str, Any]] = []
    if is_shiprocket and getattr(shipment, "awb_number", None):
        dt_shipped = shipment.shipped_at.strftime("%d %b %Y, %I:%M %p") if shipment.shipped_at else None
        courier_lbl = getattr(shipment, "courier_name", None) or "Courier Partner"
        scans.append({
            "status": "Manifest Created",
            "activity": f"Courier AWB {shipment.awb_number} generated ({courier_lbl})",
            "location": "Origin Warehouse",
            "date": dt_shipped,
        })
        scans.append({
            "status": "In Transit",
            "activity": "Package handed over to courier and in transit",
            "location": "Regional Logistics Hub",
            "date": dt_shipped,
        })
        if effective_status in ("out_for_delivery", "delivered"):
            dt_ofd = (shipment.out_for_delivery_at or shipment.shipped_at).strftime("%d %b %Y, %I:%M %p") if (shipment.out_for_delivery_at or shipment.shipped_at) else None
            scans.append({
                "status": "Out for Delivery",
                "activity": "Package out for delivery with courier executive",
                "location": "Destination City",
                "date": dt_ofd,
            })
        if effective_status == "delivered":
            dt_del = (shipment.delivered_at or shipment.shipped_at).strftime("%d %b %Y, %I:%M %p") if (shipment.delivered_at or shipment.shipped_at) else None
            scans.append({
                "status": "Delivered",
                "activity": "Package delivered to consignee",
                "location": "Destination City",
                "date": dt_del,
            })
    elif is_manual or (not is_shiprocket and not is_own_agent and (delivery_partner_name or delivery_partner_phone)):
        dt_shipped = shipment.shipped_at.strftime("%d %b %Y, %I:%M %p") if shipment.shipped_at else None
        partner_lbl = delivery_partner_name or getattr(shipment, "courier_name", None) or "Courier Partner"
        tracking_lbl = f" (Tracking/Contact: {delivery_partner_phone or getattr(shipment, 'awb_number', None)})" if (delivery_partner_phone or getattr(shipment, "awb_number", None)) else ""
        scans.append({
            "status": "Dispatched",
            "activity": f"Dispatched via {partner_lbl}{tracking_lbl}",
            "location": "Origin Warehouse",
            "date": dt_shipped,
        })
        if effective_status in ("out_for_delivery", "delivered"):
            dt_ofd = (shipment.out_for_delivery_at or shipment.shipped_at).strftime("%d %b %Y, %I:%M %p") if (shipment.out_for_delivery_at or shipment.shipped_at) else None
            scans.append({
                "status": "In Transit / Out for Delivery",
                "activity": f"In transit with {partner_lbl}",
                "location": "Destination City",
                "date": dt_ofd,
            })
        if effective_status == "delivered":
            dt_del = (shipment.delivered_at or shipment.shipped_at).strftime("%d %b %Y, %I:%M %p") if (shipment.delivered_at or shipment.shipped_at) else None
            scans.append({
                "status": "Delivered",
                "activity": "Package delivered to consignee",
                "location": "Destination City",
                "date": dt_del,
            })

    is_active_ofd = (effective_status in ("out_for_delivery", "in_transit", "shipped") or order_status in ("out_for_delivery", "in_transit", "shipped", "replacement_dispatched"))

    if is_own_agent:
        resolved_partner_name = delivery_partner_name
        resolved_partner_phone = delivery_partner_phone
        resolved_agent_id = agent_id_str
        resolved_vehicle_type = vehicle_type
    elif is_manual:
        resolved_partner_name = shipment.delivery_partner_name or getattr(shipment, "courier_name", None)
        resolved_partner_phone = shipment.delivery_partner_phone or getattr(shipment, "awb_number", None)
        resolved_agent_id = None
        resolved_vehicle_type = None
    elif is_admin:
        resolved_partner_name = delivery_partner_name
        resolved_partner_phone = delivery_partner_phone
        resolved_agent_id = agent_id_str
        resolved_vehicle_type = vehicle_type
    else:
        # Manual Courier / Shiprocket
        resolved_partner_name = delivery_partner_name or getattr(shipment, "courier_name", None)
        resolved_partner_phone = delivery_partner_phone or getattr(shipment, "awb_number", None)
        resolved_agent_id = None
        resolved_vehicle_type = None

    resolved_mode = "own_agent" if is_own_agent else ("shiprocket" if is_shiprocket else "manual")

    return {
        "id": str(shipment.id),
        "status": effective_status,
        "mode": resolved_mode,
        "delivery_mode": resolved_mode,
        "agent_id": resolved_agent_id,
        "agent_token": agent_token if (is_admin or is_active_ofd) else None,
        "delivery_partner_name": resolved_partner_name,
        "delivery_partner_phone": resolved_partner_phone,
        "vehicle_type": resolved_vehicle_type,
        "courier_name": getattr(shipment, "courier_name", None) or (resolved_partner_name if resolved_mode == "manual" else None),
        "awb_number": getattr(shipment, "awb_number", None) or (resolved_partner_phone if resolved_mode == "manual" else None),
        "tracking_url": getattr(shipment, "tracking_url", None),
        "label_url": getattr(shipment, "label_url", None),
        "estimated_delivery_at": shipment.estimated_delivery_at.isoformat() if shipment.estimated_delivery_at else None,
        "shipped_at": shipment.shipped_at.isoformat() if shipment.shipped_at else None,
        "out_for_delivery_at": shipment.out_for_delivery_at.isoformat() if shipment.out_for_delivery_at else None,
        "delivered_at": shipment.delivered_at.isoformat() if shipment.delivered_at else None,
        "notes": getattr(shipment, "notes", None),
        "scans": scans,
        "delivery_otp": getattr(shipment, "delivery_otp", None),
    }


def can_transition_order_status(current_status: str, next_status: str) -> bool:
    if current_status == next_status:
        return True
    return next_status in ALLOWED_STATUS_TRANSITIONS.get(current_status, set())


def build_default_checkout_settings() -> dict[str, Any]:
    return {
        "taxSettings": {
            "enabled": True,
            "label": "GST",
            "rate": "5",
            "applyOnShipping": False,
        },
        "charges": [
            {
                "id": "shipping_fee",
                "code": "shipping_fee",
                "label": "Shipping fee",
                "enabled": True,
                "optional": False,
                "customerSelectable": False,
                "refundable": False,
                "amountType": "fixed",
                "amountValue": "99",
                "applyConditionType": "none",
                "applyConditionValue": "",
                "waiveConditionType": "subtotal_gte",
                "waiveConditionValue": "999",
                "description": "Standard shipping charge for all eligible orders.",
            },
            {
                "id": "handling_fee",
                "code": "handling_fee",
                "label": "Handling fee",
                "enabled": False,
                "optional": False,
                "customerSelectable": False,
                "refundable": False,
                "amountType": "fixed",
                "amountValue": "29",
                "applyConditionType": "none",
                "applyConditionValue": "",
                "waiveConditionType": "none",
                "waiveConditionValue": "",
                "description": "Store handling or order processing fee.",
            },
            {
                "id": "packaging_fee",
                "code": "packaging_fee",
                "label": "Packaging fee",
                "enabled": False,
                "optional": False,
                "customerSelectable": False,
                "refundable": True,
                "amountType": "fixed",
                "amountValue": "19",
                "applyConditionType": "none",
                "applyConditionValue": "",
                "waiveConditionType": "none",
                "waiveConditionValue": "",
                "description": "Extra packaging or premium packing charge.",
            },
            {
                "id": "service_fee",
                "code": "service_fee",
                "label": "Service fee",
                "enabled": False,
                "optional": False,
                "customerSelectable": False,
                "refundable": False,
                "amountType": "fixed",
                "amountValue": "15",
                "applyConditionType": "none",
                "applyConditionValue": "",
                "waiveConditionType": "none",
                "waiveConditionValue": "",
                "description": "Store service or convenience charge.",
            },
            {
                "id": "platform_fee",
                "code": "platform_fee",
                "label": "Platform fee",
                "enabled": False,
                "optional": False,
                "customerSelectable": False,
                "refundable": False,
                "amountType": "fixed",
                "amountValue": "9",
                "applyConditionType": "none",
                "applyConditionValue": "",
                "waiveConditionType": "subtotal_gte",
                "waiveConditionValue": "799",
                "description": "Platform or service support charge.",
            },
            {
                "id": "small_order_fee",
                "code": "small_order_fee",
                "label": "Small order fee",
                "enabled": False,
                "optional": False,
                "customerSelectable": False,
                "refundable": False,
                "amountType": "fixed",
                "amountValue": "49",
                "applyConditionType": "subtotal_lt",
                "applyConditionValue": "499",
                "waiveConditionType": "none",
                "waiveConditionValue": "",
                "description": "Applies only when the order value is below a threshold.",
            },
            {
                "id": "cod_fee",
                "code": "cod_fee",
                "label": "COD fee",
                "enabled": False,
                "optional": False,
                "customerSelectable": False,
                "refundable": False,
                "amountType": "fixed",
                "amountValue": "39",
                "applyConditionType": "payment_method",
                "applyConditionValue": "cod",
                "waiveConditionType": "none",
                "waiveConditionValue": "",
                "description": "Applies when customer chooses cash on delivery.",
            },
            {
                "id": "gift_wrap",
                "code": "gift_wrap",
                "label": "Gift wrap",
                "enabled": False,
                "optional": True,
                "customerSelectable": True,
                "refundable": True,
                "amountType": "fixed",
                "amountValue": "49",
                "applyConditionType": "none",
                "applyConditionValue": "",
                "waiveConditionType": "none",
                "waiveConditionValue": "",
                "description": "",
            },
        ],
    }


def matches_apply_condition(
    charge: dict[str, Any],
    subtotal_after_discount: Decimal,
    payment_method: str,
) -> bool:
    condition_type = charge.get("applyConditionType", "none")
    condition_value = str(charge.get("applyConditionValue", "") or "").strip()

    if condition_type == "none":
        return True
    if condition_type == "subtotal_lt":
        return subtotal_after_discount < to_number(condition_value)
    if condition_type == "subtotal_gte":
        return subtotal_after_discount >= to_number(condition_value)
    if condition_type == "payment_method":
        return normalize_payment_method(condition_value) == normalize_payment_method(payment_method)
    return True


def is_charge_waived(charge: dict[str, Any], subtotal_after_discount: Decimal) -> bool:
    waive_condition_type = charge.get("waiveConditionType", "none")
    waive_condition_value = str(charge.get("waiveConditionValue", "") or "").strip()

    if waive_condition_type == "subtotal_gte":
        return subtotal_after_discount >= to_number(waive_condition_value)
    return False


def calculate_charge_amount(charge: dict[str, Any], base_amount: Decimal) -> Decimal:
    raw = to_number(charge.get("amountValue"))
    if charge.get("amountType") == "percent":
        return money((base_amount * raw) / Decimal("100"))
    return raw


def evaluate_promo_discount(
    subtotal: Decimal,
    promo_code: Optional[str],
    site_id: Optional[UUID] = None,
    session: Optional[Session] = None,
    customer_email: Optional[str] = None,
    delivery_fee: Decimal = Decimal("0.00"),
    cart_items: Optional[list[dict[str, Any]]] = None,
) -> tuple[Optional[str], Decimal, Optional[Coupon]]:
    normalized = str(promo_code or "").strip().upper()
    if not normalized:
        return None, Decimal("0.00"), None

    if not site_id or not session:
        if normalized.lower() == "save10":
            return normalized, money(subtotal * Decimal("0.10")), None
        return normalized or None, Decimal("0.00"), None

    coupon = session.exec(
        select(Coupon).where(
            Coupon.site_id == site_id,
            Coupon.code == normalized,
            Coupon.is_active == True,
        )
    ).first()

    if not coupon:
        return None, Decimal("0.00"), None

    now = datetime.now(timezone.utc)
    if coupon.starts_at and now < coupon.starts_at:
        return None, Decimal("0.00"), None
    if coupon.expires_at and now > coupon.expires_at:
        return None, Decimal("0.00"), None
    if coupon.total_usage_limit is not None and coupon.times_used >= coupon.total_usage_limit:
        return None, Decimal("0.00"), None
    if subtotal < coupon.min_order_value:
        return None, Decimal("0.00"), None

    # Customer specific rules
    if customer_email:
        email_clean = customer_email.strip().lower()
        if coupon.is_first_order_only:
            past_order = session.exec(
                select(Order)
                .join(User, Order.customer_id == User.id)
                .where(
                    Order.site_id == site_id,
                    User.email == email_clean,
                    Order.status != "cancelled",
                )
            ).first()
            if past_order:
                return None, Decimal("0.00"), None

        if coupon.per_customer_limit:
            usage_count = session.exec(
                select(func.count(CouponUsage.id)).where(
                    CouponUsage.site_id == site_id,
                    CouponUsage.coupon_id == coupon.id,
                    CouponUsage.customer_email == email_clean,
                )
            ).one()
            if usage_count >= coupon.per_customer_limit:
                return None, Decimal("0.00"), None

    # Evaluate targeting (collections / categories)
    applies_to = getattr(coupon, "applies_to", "all") or "all"
    col_ids = [str(c).strip() for c in (getattr(coupon, "collection_ids", []) or []) if str(c).strip()]
    cat_ids = [str(c).strip() for c in (getattr(coupon, "category_ids", []) or []) if str(c).strip()]

    qualifying_subtotal = subtotal

    if (applies_to == "collections" and col_ids) or (applies_to == "categories" and cat_ids):
        if not cart_items:
            return None, Decimal("0.00"), None

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
            return None, Decimal("0.00"), None

        qualifying_pids = set()

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
            return None, Decimal("0.00"), None

        qualifying_subtotal = sum((line_total for pid, line_total in item_product_map if pid in qualifying_pids), Decimal("0.00"))
        if qualifying_subtotal <= Decimal("0.00"):
            return None, Decimal("0.00"), None

    discount_amount = Decimal("0.00")
    if coupon.discount_type == "percentage":
        computed = (qualifying_subtotal * coupon.discount_value) / Decimal("100.00")
        if coupon.max_discount_amount is not None and coupon.max_discount_amount > 0:
            computed = min(computed, coupon.max_discount_amount)
        discount_amount = min(computed, qualifying_subtotal)
    elif coupon.discount_type == "fixed_amount":
        discount_amount = min(coupon.discount_value, qualifying_subtotal)
    elif coupon.discount_type == "free_shipping":
        discount_amount = delivery_fee

    discount_amount = money(discount_amount)
    return coupon.code, discount_amount, coupon


def extract_variant_details(
    product: Product,
    selected_variant_value: Optional[str],
    raise_if_out_of_stock: bool = True,
) -> tuple[Decimal, Optional[Decimal], Optional[str], int]:
    variant_option = product.variant_option or {}
    option_name = variant_option.get("optionName")
    option_values = variant_option.get("optionValues") or []

    if not selected_variant_value:
        available_stock = product.stock if (product.in_stock is not False and product.stock > 0) else 0
        if raise_if_out_of_stock and (product.in_stock is False or product.stock <= 0):
            raise HTTPException(status_code=400, detail="Product is out of stock")
        return (
            money(product.price),
            money(product.compare_price) if product.compare_price is not None else None,
            option_name,
            available_stock,
        )

    for option in option_values:
        if option.get("value") == selected_variant_value:
            price = (
                money(option["price"])
                if option.get("price") is not None
                else money(product.price)
            )
            compare_price = (
                money(option["comparePrice"])
                if option.get("comparePrice") is not None
                else (money(product.compare_price) if product.compare_price is not None else None)
            )
            stock_qty = option.get("stockQty")
            variant_stock_qty = int(stock_qty) if stock_qty is not None else product.stock
            option_in_stock = option.get("inStock")

            if option_in_stock is False or variant_stock_qty <= 0:
                if raise_if_out_of_stock:
                    raise HTTPException(status_code=400, detail="Selected variant is out of stock")
                variant_stock_qty = 0

            return (
                price,
                compare_price,
                option_name,
                variant_stock_qty,
            )

    if raise_if_out_of_stock:
        raise HTTPException(status_code=400, detail="Invalid selected variant")

    return (
        money(product.price),
        money(product.compare_price) if product.compare_price is not None else None,
        option_name,
        0,
    )


def decrement_product_stock(
    product: Product,
    quantity: int,
    selected_variant_value: Optional[str],
) -> None:
    if product.stock < quantity:
        raise HTTPException(status_code=409, detail=f"Insufficient stock for {product.name}")

    product.stock -= quantity
    product.in_stock = product.stock > 0

    if selected_variant_value:
        variant_option = deepcopy(product.variant_option or {})
        option_values = variant_option.get("optionValues") or []
        found = False

        for option in option_values:
            if option.get("value") == selected_variant_value:
                stock_qty = int(option.get("stockQty") or 0)
                if stock_qty < quantity:
                    raise HTTPException(status_code=409, detail=f"Insufficient variant stock for {product.name}")
                stock_qty -= quantity
                option["stockQty"] = stock_qty
                option["inStock"] = stock_qty > 0
                found = True
                break

        if not found:
            raise HTTPException(status_code=400, detail=f"Invalid variant for {product.name}")

        product.variant_option = variant_option

    product.updated_at = utc_now()


def increment_product_stock(
    product: Product,
    quantity: int,
    selected_variant_value: Optional[str],
) -> None:
    product.stock = int(product.stock or 0) + int(quantity)
    product.in_stock = product.stock > 0

    variant_payload = product.variant_option
    if not variant_payload or not selected_variant_value:
        product.updated_at = utc_now()
        return

    if not isinstance(variant_payload, dict):
        product.updated_at = utc_now()
        return

    variant_option = deepcopy(variant_payload)
    option_values = variant_option.get("optionValues")

    if option_values is None:
        option_values = variant_option.get("option_values")

    if not isinstance(option_values, list):
        product.updated_at = utc_now()
        return

    normalized_selected = str(selected_variant_value).strip().lower()
    found = False

    for option in option_values:
        if not isinstance(option, dict):
            continue

        raw_value = option.get("value")
        raw_label = option.get("label")
        raw_name = option.get("name")

        candidates = {
            str(raw_value).strip().lower() if raw_value is not None else "",
            str(raw_label).strip().lower() if raw_label is not None else "",
            str(raw_name).strip().lower() if raw_name is not None else "",
        }

        if normalized_selected in candidates:
            current_stock = option.get("stockQty")
            if current_stock is None:
                current_stock = option.get("stock_qty")

            try:
                stock_qty = int(current_stock or 0) + int(quantity)
            except (TypeError, ValueError):
                stock_qty = int(quantity)

            option["stockQty"] = stock_qty
            option["inStock"] = stock_qty > 0

            if "stock_qty" in option:
                option["stock_qty"] = stock_qty
            if "in_stock" in option:
                option["in_stock"] = stock_qty > 0

            found = True
            break

    if found:
        if "optionValues" in variant_option:
            variant_option["optionValues"] = option_values
        elif "option_values" in variant_option:
            variant_option["option_values"] = option_values
        else:
            variant_option["optionValues"] = option_values

        product.variant_option = variant_option

    product.updated_at = utc_now()


def evaluate_pricing(
    cart_items: list[dict[str, Any]],
    checkout_settings: dict[str, Any],
    payment_method: str,
    selected_optional_charge_ids: list[str],
    promo_code: Optional[str],
    site_id: Optional[UUID] = None,
    session: Optional[Session] = None,
    customer_email: Optional[str] = None,
) -> dict[str, Any]:
    subtotal = sum((item["line_total"] for item in cart_items), Decimal("0.00"))
    applied_promo_code, promo_discount, coupon_obj = evaluate_promo_discount(
        subtotal=subtotal,
        promo_code=promo_code,
        site_id=site_id,
        session=session,
        customer_email=customer_email,
        cart_items=cart_items,
    )
    subtotal_after_discount = max(subtotal - promo_discount, Decimal("0.00"))

    charges = checkout_settings.get("charges") or []
    enabled_charges = [charge for charge in charges if charge.get("enabled")]
    auto_applied = [
        charge
        for charge in enabled_charges
        if not (charge.get("customerSelectable") and charge.get("optional"))
    ]
    selected_optional = [
        charge
        for charge in enabled_charges
        if charge.get("customerSelectable")
        and charge.get("optional")
        and charge.get("id") in selected_optional_charge_ids
    ]

    applied_charges: list[dict[str, Any]] = []
    waived_charges: list[dict[str, Any]] = []

    for charge in [*auto_applied, *selected_optional]:
        if not matches_apply_condition(charge, subtotal_after_discount, payment_method):
            continue

        base_amount = calculate_charge_amount(charge, subtotal_after_discount)
        waived = is_charge_waived(charge, subtotal_after_discount)
        final_amount = Decimal("0.00") if waived else base_amount

        charge_snapshot = {
            "id": charge.get("id"),
            "code": charge.get("code"),
            "label": charge.get("label"),
            "amountType": charge.get("amountType"),
            "amountValue": str(charge.get("amountValue")),
            "amount": float(base_amount),
            "finalAmount": float(final_amount),
            "applied": True,
            "waived": waived,
            "refundable": bool(charge.get("refundable", True)),
            "applyConditionType": charge.get("applyConditionType"),
            "applyConditionValue": charge.get("applyConditionValue"),
            "waiveConditionType": charge.get("waiveConditionType"),
            "waiveConditionValue": charge.get("waiveConditionValue"),
            "customerSelectable": bool(charge.get("customerSelectable")),
            "optional": bool(charge.get("optional")),
        }

        if waived:
            waived_charges.append(charge_snapshot)

        if final_amount > 0:
            applied_charges.append(charge_snapshot)

    charges_total = sum(
        (Decimal(str(charge["finalAmount"])) for charge in applied_charges),
        Decimal("0.00"),
    )

    tax_settings = checkout_settings.get("taxSettings") or {}
    tax_enabled = bool(tax_settings.get("enabled"))
    tax_rate = to_number(tax_settings.get("rate"))
    apply_on_shipping = bool(tax_settings.get("applyOnShipping"))
    tax_base = subtotal_after_discount + charges_total if apply_on_shipping else subtotal_after_discount
    tax_amount = money((tax_base * tax_rate) / Decimal("100")) if tax_enabled else Decimal("0.00")

    total = max(subtotal_after_discount + charges_total + tax_amount, Decimal("0.00"))

    return {
        "currency": "INR",
        "subtotal": float(subtotal),
        "promoCode": applied_promo_code,
        "promoDiscount": float(promo_discount),
        "subtotalAfterDiscount": float(subtotal_after_discount),
        "selectedOptionalChargeIds": selected_optional_charge_ids,
        "charges": applied_charges,
        "waivedCharges": waived_charges,
        "tax": {
            "enabled": tax_enabled,
            "label": tax_settings.get("label") or "Tax",
            "rate": float(tax_rate),
            "applyOnShipping": apply_on_shipping,
            "amount": float(tax_amount),
        },
        "discounts": (
            [{
                "code": "promo_code",
                "label": applied_promo_code,
                "amount": float(promo_discount),
                "couponId": str(coupon_obj.id) if coupon_obj else None,
            }]
            if promo_discount > 0 and applied_promo_code
            else []
        ),
        "couponId": str(coupon_obj.id) if coupon_obj else None,
        "discountAmount": float(promo_discount),
        "total": float(total),
        "paymentMethod": payment_method,
    }


def build_order_item_pricing_snapshot(
    line_total: Decimal,
    quantity: int,
    order_subtotal: Decimal,
    pricing_snapshot: dict[str, Any],
) -> dict[str, Any]:
    ratio = Decimal("0.00")
    if order_subtotal > 0:
        ratio = line_total / order_subtotal

    tax_dict = pricing_snapshot.get("tax") if isinstance(pricing_snapshot.get("tax"), dict) else {}
    tax_amount = money(Decimal(str(tax_dict.get("amount", 0))) * ratio)
    promo_discount = money(Decimal(str(pricing_snapshot.get("promoDiscount", 0))) * ratio)

    shipping_allocated = Decimal("0.00")
    cod_fee_allocated = Decimal("0.00")
    other_charges_allocated = Decimal("0.00")
    refundable_charges_allocated = Decimal("0.00")
    non_refundable_charges_allocated = Decimal("0.00")
    charges_breakdown: list[dict[str, Any]] = []

    for charge in pricing_snapshot.get("charges", []):
        charge_id = charge.get("id")
        code = charge.get("code")
        label = charge.get("label") or code or "Charge"
        is_refundable = bool(charge.get("refundable", True))
        final_amount = money(charge.get("finalAmount") or 0)
        allocated = money(final_amount * ratio)

        if is_refundable:
            refundable_charges_allocated += allocated
        else:
            non_refundable_charges_allocated += allocated

        if code == "shipping_fee":
            shipping_allocated += allocated
        elif code == "cod_fee":
            cod_fee_allocated += allocated
        else:
            other_charges_allocated += allocated

        charges_breakdown.append({
            "id": charge_id,
            "code": code,
            "label": label,
            "refundable": is_refundable,
            "total_order_amount": float(final_amount),
            "item_allocated_amount": float(allocated),
        })

    refundable_line_total = money(
        line_total - promo_discount + tax_amount + refundable_charges_allocated
    )
    final_paid_for_line = money(
        line_total - promo_discount + tax_amount + refundable_charges_allocated + non_refundable_charges_allocated
    )

    return {
        "unit_price": float(money(line_total / quantity)),
        "quantity": quantity,
        "gross_line_total": float(line_total),
        "discount_allocated": float(promo_discount),
        "tax_amount": float(tax_amount),
        "shipping_allocated": float(shipping_allocated),
        "cod_fee_allocated": float(cod_fee_allocated),
        "other_charges_allocated": float(other_charges_allocated),
        "refundable_charges_allocated": float(refundable_charges_allocated),
        "non_refundable_charges_allocated": float(non_refundable_charges_allocated),
        "refundable_line_total": float(refundable_line_total),
        "final_paid_for_line": float(final_paid_for_line),
        "charges_breakdown": charges_breakdown,
    }


def serialize_customer_order_item(item: OrderItem, order_status: Optional[str] = None) -> dict[str, Any]:
    qty = int(item.quantity or 1)
    returnable_quantity = max(int(item.returnable_quantity if item.returnable_quantity is not None else (qty if order_status == "delivered" else 0)), 0)

    effective_status = item.status or "placed"
    if order_status in ("confirmed", "shipped", "out_for_delivery"):
        if effective_status not in ("cancelled", "returned", "delivered"):
            effective_status = order_status
    elif order_status == "delivered":
        if returnable_quantity > 0:
            effective_status = "delivered"
        elif returnable_quantity == 0 and item.status == "returned":
            effective_status = "returned"
        elif item.status not in ("delivered", "returned", "cancelled"):
            effective_status = "delivered"
    elif order_status == "returned":
        effective_status = "returned"
    elif order_status == "cancelled" and item.status != "cancelled":
        effective_status = "cancelled"

    item_return_days = getattr(item, "return_window_days", 7)
    is_returnable = (order_status == "delivered" and returnable_quantity > 0 and item_return_days > 0)

    unit_price = float(item.unit_price) if item.unit_price is not None else 0.0
    line_total = float(item.line_total) if item.line_total is not None else (unit_price * qty)

    return {
        "id": str(item.id),
        "product_id": str(item.product_id) if item.product_id else None,
        "product_name": item.product_name or "Product",
        "product_slug": item.product_slug or "",
        "product_image": item.product_image or "",
        "selected_variant_label": item.selected_variant_label,
        "selected_variant_value": item.selected_variant_value,
        "unit_price": unit_price,
        "compare_price": float(item.compare_price) if item.compare_price is not None else None,
        "quantity": qty,
        "line_total": line_total,
        "status": effective_status,
        "returnable_quantity": returnable_quantity,
        "return_window_days": item_return_days,
        "is_returnable": is_returnable,
        "max_returnable_quantity": returnable_quantity,
        "pricing_snapshot": item.pricing_snapshot,
    }


def _sync_order_return_status(order: Order, session: Session, items: Optional[list[OrderItem]] = None) -> bool:
    """
    Checks if an order that was 'delivered' has all its items returned & refunded.
    - If part of the order was refunded: payment_status = 'partially_refunded'.
    - If ALL items in the order have completed refunds (r.status in ('refunded', 'closed')):
      order.status = 'returned', order.payment_status = 'refunded', escrow_status = 'reversed'.
    - Returnable quantity on items reflects remaining units eligible for return.
    """
    from models import ReturnRequest, ReturnItem

    if order.status in ("cancelled", "placed", "confirmed", "shipped", "out_for_delivery"):
        return False

    order_items = items if items is not None else session.exec(
        select(OrderItem).where(OrderItem.order_id == order.id)
    ).all()
    if not order_items:
        return False

    all_order_returns = session.exec(
        select(ReturnRequest).where(ReturnRequest.order_id == order.id)
    ).all()

    has_changes = False
    now = utc_now()

    # 1. Calculate each item's actual returnable quantity
    for item in order_items:
        ret_items = session.exec(
            select(ReturnItem).where(ReturnItem.order_item_id == item.id)
        ).all()
        active_ret_qty = 0
        for ri in ret_items:
            req = session.get(ReturnRequest, ri.return_request_id)
            if req and req.status != "rejected":
                if req.status in ("received", "inspected", "refunded", "closed"):
                    actual_qty = ri.quantity_received
                else:
                    actual_qty = ri.quantity_approved if (ri.quantity_approved and ri.quantity_approved > 0) else ri.quantity_requested
                active_ret_qty += int(actual_qty or 0)
        expected_returnable = max(0, item.quantity - active_ret_qty)
        if item.returnable_quantity != expected_returnable:
            item.returnable_quantity = expected_returnable
            item.updated_at = now
            session.add(item)
            has_changes = True

    if not all_order_returns:
        return has_changes

    # 2. Only consider COMPLETED refunds (refunded or closed)
    completed_returns = [
        r for r in all_order_returns
        if r.status in ("refunded", "closed")
    ]
    completed_return_ids = [r.id for r in completed_returns]

    if not completed_return_ids:
        # No completed refunds yet - ensure status remains delivered / paid
        if order.status == "returned":
            order.status = "delivered"
            order.updated_at = now
            session.add(order)
            has_changes = True
        return has_changes

    refunded_items = session.exec(
        select(ReturnItem).where(ReturnItem.return_request_id.in_(completed_return_ids))
    ).all()

    total_order_qty = sum(item.quantity for item in order_items)
    total_refunded_qty = sum(
        (ri.quantity_received if ri.quantity_received is not None else (ri.quantity_approved or ri.quantity_requested or 0))
        for ri in refunded_items
    )

    # Update item statuses based on completed refunds
    for item in order_items:
        item_refunded_qty = sum(
            (ri.quantity_received if ri.quantity_received is not None else (ri.quantity_approved or ri.quantity_requested or 0))
            for ri in refunded_items
            if ri.order_item_id == item.id
        )
        if item_refunded_qty >= item.quantity:
            if item.status != "returned":
                item.status = "returned"
                item.updated_at = now
                session.add(item)
                has_changes = True
        else:
            if item.status == "returned":
                item.status = "delivered"
                item.updated_at = now
                session.add(item)
                has_changes = True

    # Full refund completed for all items
    if total_refunded_qty >= total_order_qty and total_order_qty > 0:
        if order.status != "returned":
            order.status = "returned"
            order.updated_at = now
            session.add(order)
            has_changes = True
        if order.payment_status != "refunded":
            order.payment_status = "refunded"
            order.updated_at = now
            session.add(order)
            has_changes = True
        if getattr(order, "escrow_status", None) != "reversed":
            order.escrow_status = "reversed"
            order.updated_at = now
            session.add(order)
            has_changes = True
    elif total_refunded_qty > 0:
        # Partial refund completed
        if order.status == "returned":
            order.status = "delivered"
            order.updated_at = now
            session.add(order)
            has_changes = True
        if order.payment_status != "partially_refunded":
            order.payment_status = "partially_refunded"
            order.updated_at = now
            session.add(order)
            has_changes = True
    else:
        if order.status == "returned":
            order.status = "delivered"
            order.updated_at = now
            session.add(order)
            has_changes = True

    return has_changes


class PlaceOrderRequest(BaseModel):
    address_id: UUID
    payment_method: str = Field(min_length=1, max_length=30)
    selected_optional_charge_ids: list[str] = Field(default_factory=list)
    promo_code: Optional[str] = None
    payment_meta: dict[str, Any] = Field(default_factory=dict)

    @field_validator("payment_method")
    @classmethod
    def clean_payment_method(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Payment method is required")
        return value

    @field_validator("promo_code")
    @classmethod
    def clean_promo_code(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None


class UpdateOrderStatusRequest(BaseModel):
    status: str = Field(min_length=1, max_length=40)
    delivery_partner_name: Optional[str] = Field(default=None, max_length=255)
    delivery_partner_phone: Optional[str] = Field(default=None, max_length=30)
    estimated_delivery_at: Optional[datetime] = None
    cancel_reason: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        value = value.strip()
        if value not in ORDER_STATUSES:
            raise ValueError("Invalid order status")
        return value


class CancelOrderRequest(BaseModel):
    cancel_reason: Optional[str] = None


# =========================
# ADMIN ROUTES FIRST
# =========================


@router.get("/admin/{site_id}/pending-counts")
def get_admin_pending_counts(
    site_id: UUID,
    admin=Depends(authenticate_admin),
    ownership=Depends(enforce_site_ownership),
    session: Session = Depends(get_session),
):
    """
    Returns the count of orders needing attention (placed) and
    returns needing attention (requested). Used for sidebar badge.
    """
    if not check_admin_has_permission(admin["adminId"], "orders:view", session):
        raise HTTPException(status_code=403, detail="You do not have permission to view orders")

    from models import ReturnRequest

    new_orders = session.exec(
        select(func.count()).select_from(Order).where(
            Order.site_id == site_id,
            Order.status == "placed",
        )
    ).one()

    new_returns = session.exec(
        select(func.count()).select_from(ReturnRequest).where(
            ReturnRequest.site_id == site_id,
            ReturnRequest.status == "requested",
        )
    ).one()

    return {
        "new_orders": new_orders,
        "new_returns": new_returns,
        "total": new_orders + new_returns,
    }


ORDER_TAB_STATUS_MAP = {
    "new": ["placed"],
    "yet_to_ship": ["confirmed", "accepted"],
    "yet_to_deliver": ["shipped", "out_for_delivery", "rescheduled", "failed", "replacement_dispatched"],
    "delivered": ["delivered", "returned"],
    "cancelled": ["cancelled", "partially_cancelled", "refunded"],
}


@router.get("/admin/{site_id}")
def get_admin_orders(
    site_id: UUID,
    page: Optional[int] = Query(None, ge=1, description="Page number"),
    page_size: Optional[int] = Query(None, ge=1, le=100, description="Items per page"),
    tab: Optional[str] = Query(None, description="Filter by tab: new, yet_to_ship, yet_to_deliver, delivered, cancelled"),
    status: Optional[str] = Query(None, description="Direct status filter"),
    search: Optional[str] = Query(None, description="Search by order ID, customer name, phone, email"),
    payment_method: Optional[str] = Query(None, description="Filter by payment method: all, upi, card, cod, etc."),
    fulfillment: Optional[str] = Query(None, description="Filter by fulfillment mode: all, own_agent, shiprocket, manual, unassigned"),
    date_filter: Optional[str] = Query(None, description="all, today, last_7_days, last_30_days, custom"),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    admin=Depends(authenticate_admin),
    ownership=Depends(enforce_site_ownership),
    session: Session = Depends(get_session),
):
    if not check_admin_has_permission(admin["adminId"], "orders:view", session):
        raise HTTPException(status_code=403, detail="You do not have permission to view orders")

    base_query = select(Order).where(Order.site_id == site_id)

    # 1. Filter by Tab or Status
    if tab and tab in ORDER_TAB_STATUS_MAP:
        base_query = base_query.where(Order.status.in_(ORDER_TAB_STATUS_MAP[tab]))
    elif status and status != "all":
        base_query = base_query.where(Order.status == status)

    # 2. Payment Method Filter
    if payment_method and payment_method != "all":
        base_query = base_query.where(Order.payment_method.ilike(f"%{payment_method}%"))

    # 3. Search Filter
    if search and search.strip():
        term = f"%{search.strip()}%"
        base_query = base_query.where(
            (cast(Order.id, String).ilike(term))
            | (cast(Order.shipping_address, String).ilike(term))
            | (Order.payment_method.ilike(term))
        )

    # 4. Date Filter
    now = datetime.now(timezone.utc)
    start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if date_filter == "today":
        base_query = base_query.where(Order.created_at >= start_of_today)
    elif date_filter == "last_7_days":
        from datetime import timedelta
        base_query = base_query.where(Order.created_at >= now - timedelta(days=7))
    elif date_filter == "last_30_days":
        from datetime import timedelta
        base_query = base_query.where(Order.created_at >= now - timedelta(days=30))
    elif date_filter == "custom":
        if from_date:
            try:
                dt_from = datetime.fromisoformat(from_date)
                base_query = base_query.where(Order.created_at >= dt_from)
            except Exception:
                pass
        if to_date:
            try:
                dt_to = datetime.fromisoformat(to_date)
                base_query = base_query.where(Order.created_at <= dt_to)
            except Exception:
                pass

    # Compute Tab Counts directly in PostgreSQL respecting active search and filters
    tab_counts = {}
    for t_key, statuses in ORDER_TAB_STATUS_MAP.items():
        cnt_q = select(func.count()).select_from(Order).where(
            Order.site_id == site_id,
            Order.status.in_(statuses),
        )
        if payment_method and payment_method != "all":
            cnt_q = cnt_q.where(Order.payment_method.ilike(f"%{payment_method}%"))
        if search and search.strip():
            term = f"%{search.strip()}%"
            cnt_q = cnt_q.where(
                (cast(Order.id, String).ilike(term))
                | (cast(Order.shipping_address, String).ilike(term))
                | (Order.payment_method.ilike(term))
            )
        if date_filter == "today":
            cnt_q = cnt_q.where(Order.created_at >= start_of_today)
        elif date_filter == "last_7_days":
            from datetime import timedelta
            cnt_q = cnt_q.where(Order.created_at >= now - timedelta(days=7))
        elif date_filter == "last_30_days":
            from datetime import timedelta
            cnt_q = cnt_q.where(Order.created_at >= now - timedelta(days=30))
        elif date_filter == "custom":
            if from_date:
                try:
                    dt_from = datetime.fromisoformat(from_date)
                    cnt_q = cnt_q.where(Order.created_at >= dt_from)
                except Exception:
                    pass
            if to_date:
                try:
                    dt_to = datetime.fromisoformat(to_date)
                    cnt_q = cnt_q.where(Order.created_at <= dt_to)
                except Exception:
                    pass
        cnt = session.exec(cnt_q).one() or 0
        tab_counts[t_key] = cnt

    # Total Count for active query
    total_count = session.exec(
        select(func.count()).select_from(base_query.subquery())
    ).one() or 0

    # Paginate
    if page is not None and page_size is not None:
        total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 1
        paginated_query = (
            base_query.order_by(Order.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        orders = session.exec(paginated_query).all()
    else:
        orders = session.exec(base_query.order_by(Order.created_at.desc())).all()
        total_pages = 1

    order_ids = [order.id for order in orders]
    shipment_map: dict[UUID, Shipment] = {}
    order_items_map: dict[UUID, list[OrderItem]] = {}

    if order_ids:
        shipments = session.exec(
            select(Shipment).where(Shipment.order_id.in_(order_ids))
        ).all()
        shipment_map = {shipment.order_id: shipment for shipment in shipments}

        order_items = session.exec(
            select(OrderItem)
            .where(OrderItem.order_id.in_(order_ids))
            .order_by(OrderItem.id.asc())
        ).all()
        for item in order_items:
            order_items_map.setdefault(item.order_id, []).append(item)

        prod_ids = [item.product_id for item in order_items if item.product_id]
        prod_weights: dict[UUID, int] = {}
        if prod_ids:
            from models import Product
            prods = session.exec(select(Product.id, Product.weight_grams).where(Product.id.in_(prod_ids))).all()
            prod_weights = {p_id: (w if w and w > 0 else 500) for p_id, w in prods}

    has_admin_sync = False
    for order in orders:
        if _sync_order_return_status(order, session, order_items_map.get(order.id)):
            has_admin_sync = True
    if has_admin_sync:
        try:
            session.commit()
        except Exception:
            session.rollback()

    serialized = [
        {
            "id": str(order.id),
            "customer_id": str(order.customer_id),
            "status": order.status,
            "payment_status": getattr(order, "payment_status", None),
            "total": float(order.total),
            "total_weight_grams": sum(prod_weights.get(item.product_id, 500) * (item.quantity or 1) for item in order_items_map.get(order.id, [])),
            "payment_method": order.payment_method,
            "razorpay_payment_id": order.razorpay_payment_id,
            "razorpay_order_id": order.razorpay_order_id,
            "created_at": order.created_at.isoformat() if order.created_at else None,
            "confirmed_at": order.confirmed_at.isoformat() if order.confirmed_at else None,
            "shipped_at": order.shipped_at.isoformat() if order.shipped_at else None,
            "delivered_at": order.delivered_at.isoformat() if order.delivered_at else None,
            "cancelled_at": order.cancelled_at.isoformat() if order.cancelled_at else None,
            "cancel_reason": order.cancel_reason,
            "customer_name": (order.shipping_address or {}).get("fullName"),
            "customer_phone": (order.shipping_address or {}).get("mobileNumber"),
            "customer_email": (order.shipping_address or {}).get("email"),
            "shipping_address": order.shipping_address,
            "delivery_otp": None if bool(shipment_map.get(order.id) and (getattr(shipment_map.get(order.id), "delivery_mode", None) == "shiprocket" or getattr(shipment_map.get(order.id), "mode", None) == "shiprocket" or shipment_map.get(order.id).courier_name or shipment_map.get(order.id).awb_number)) else ensure_order_delivery_otp(order, session),
            "shipment": serialize_shipment(shipment_map.get(order.id), order_status=order.status, session=session, is_admin=True),
            "items": [
                {
                    "id": str(item.id),
                    "product_id": str(item.product_id),
                    "product_name": item.product_name,
                    "product_slug": item.product_slug,
                    "product_image": item.product_image,
                    "selected_variant_label": item.selected_variant_label,
                    "selected_variant_value": item.selected_variant_value,
                    "unit_price": float(item.unit_price),
                    "compare_price": float(item.compare_price) if item.compare_price is not None else None,
                    "quantity": item.quantity,
                    "line_total": float(item.line_total),
                    "weight_grams": prod_weights.get(item.product_id, 500),
                    "status": item.status,
                    "returnable_quantity": item.returnable_quantity,
                    "return_window_days": getattr(item, "return_window_days", 7),
                    "is_returnable": getattr(item, "return_window_days", 7) > 0,
                    "pricing_snapshot": item.pricing_snapshot,
                }
                for item in order_items_map.get(order.id, [])
            ],
            "item_count": len(order_items_map.get(order.id, [])),
            "pricing_snapshot": order.pricing_snapshot,
        }
        for order in orders
    ]

    if page is not None and page_size is not None:
        return {
            "orders": serialized,
            "total": total_count,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "tab_counts": tab_counts,
        }

    return serialized


@router.get("/admin/{site_id}/{order_id}")
def get_admin_order_detail(
    site_id: UUID,
    order_id: UUID,
    admin=Depends(authenticate_admin),
    ownership=Depends(enforce_site_ownership),
    session: Session = Depends(get_session),
):
    if not check_admin_has_permission(admin["adminId"], "orders:view", session):
        raise HTTPException(status_code=403, detail="You do not have permission to view orders")

    order = session.get(Order, order_id)
    if not order or order.site_id != site_id:
        raise HTTPException(status_code=404, detail="Order not found")

    items = session.exec(
        select(OrderItem)
        .where(OrderItem.order_id == order.id)
        .order_by(OrderItem.id.asc())
    ).all()

    if _sync_order_return_status(order, session, items):
        try:
            session.commit()
        except Exception:
            session.rollback()

    shipment = session.exec(
        select(Shipment).where(Shipment.order_id == order.id)
    ).first()

    history = session.exec(
        select(OrderStatusHistory)
        .where(OrderStatusHistory.order_id == order.id)
        .order_by(OrderStatusHistory.id.asc())
    ).all()

    detail_prod_ids = [item.product_id for item in items if item.product_id]
    detail_prod_weights: dict[UUID, int] = {}
    if detail_prod_ids:
        from models import Product
        d_prods = session.exec(select(Product.id, Product.weight_grams).where(Product.id.in_(detail_prod_ids))).all()
        detail_prod_weights = {p_id: (w if w and w > 0 else 500) for p_id, w in d_prods}

    return {
        "id": str(order.id),
        "customer_id": str(order.customer_id),
        "customer_name": (order.shipping_address or {}).get("fullName"),
        "customer_phone": (order.shipping_address or {}).get("mobileNumber"),
        "customer_email": (order.shipping_address or {}).get("email"),
        "status": order.status,
        "payment_status": getattr(order, "payment_status", None),
        "total": float(order.total),
        "total_weight_grams": sum(detail_prod_weights.get(item.product_id, 500) * (item.quantity or 1) for item in items),
        "payment_method": order.payment_method,
        "razorpay_payment_id": order.razorpay_payment_id,
        "razorpay_order_id": order.razorpay_order_id,
        "shipping_address": order.shipping_address,
        "pricing_snapshot": order.pricing_snapshot,
        "delivery_otp": None if bool(shipment and (getattr(shipment, "delivery_mode", None) == "shiprocket" or getattr(shipment, "mode", None) == "shiprocket" or shipment.courier_name or shipment.awb_number)) else ensure_order_delivery_otp(order, session),
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "confirmed_at": order.confirmed_at.isoformat() if order.confirmed_at else None,
        "shipped_at": order.shipped_at.isoformat() if order.shipped_at else None,
        "delivered_at": order.delivered_at.isoformat() if order.delivered_at else None,
        "cancelled_at": order.cancelled_at.isoformat() if order.cancelled_at else None,
        "cancel_reason": order.cancel_reason,
        "items": [
            {
                "id": str(item.id),
                "product_id": str(item.product_id),
                "product_name": item.product_name,
                "product_slug": item.product_slug,
                "product_image": item.product_image,
                "selected_variant_label": item.selected_variant_label,
                "selected_variant_value": item.selected_variant_value,
                "unit_price": float(item.unit_price),
                "compare_price": float(item.compare_price) if item.compare_price is not None else None,
                "quantity": item.quantity,
                "line_total": float(item.line_total),
                "weight_grams": detail_prod_weights.get(item.product_id, 500),
                "status": item.status,
                "returnable_quantity": item.returnable_quantity,
                "return_window_days": getattr(item, "return_window_days", 7),
                "is_returnable": getattr(item, "return_window_days", 7) > 0,
                "pricing_snapshot": item.pricing_snapshot,
            }
            for item in items
        ],
        "shipment": serialize_shipment(shipment, order_status=order.status, session=session, is_admin=True),
        "status_history": [
            {
                "id": str(entry.id),
                "status": entry.status,
                "changed_by": str(entry.changed_by) if entry.changed_by else None,
                "changed_by_type": entry.changed_by_type,
                "created_at": (
                    entry.created_at.isoformat()
                    if hasattr(entry, "created_at") and getattr(entry, "created_at", None)
                    else None
                ),
            }
            for entry in history
        ],
    }


@router.patch("/admin/{site_id}/{order_id}/status")
def update_order_status(
    site_id: UUID,
    order_id: UUID,
    payload: UpdateOrderStatusRequest,
    request: Request = None,
    admin=Depends(authenticate_admin),
    ownership=Depends(enforce_site_ownership),
    session: Session = Depends(get_session),
):
    if payload.status == "cancelled":
        if not (check_admin_has_permission(admin["adminId"], "orders:cancel", session) or check_admin_has_permission(admin["adminId"], "orders:update", session)):
            raise HTTPException(status_code=403, detail="You do not have permission to cancel orders")
    else:
        if not check_admin_has_permission(admin["adminId"], "orders:update", session):
            raise HTTPException(status_code=403, detail="You do not have permission to update order status")

    order = session.get(Order, order_id)
    if not order or order.site_id != site_id:
        raise HTTPException(status_code=404, detail="Order not found")

    if not can_transition_order_status(order.status, payload.status):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status transition from {order.status} to {payload.status}",
        )

    items = session.exec(
        select(OrderItem).where(OrderItem.order_id == order.id)
    ).all()

    shipment = session.exec(
        select(Shipment).where(Shipment.order_id == order.id)
    ).first()

    now = utc_now()
    previous_status = order.status
    order.status = payload.status

    try:
        if payload.status == "confirmed":
            order.confirmed_at = now
            for item in items:
                if item.status not in ("cancelled", "returned"):
                    item.status = "confirmed"
                    session.add(item)

        elif payload.status == "shipped":
            # Guard: ensure an agent or partner is assigned before moving to shipped
            has_partner = bool(
                payload.delivery_partner_name
                or (shipment and (shipment.agent_id or shipment.delivery_partner_name or shipment.courier_name))
            )
            if not has_partner:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot move order to Shipped without assigning a Delivery Agent or Courier Partner first. Please dispatch or assign a rider.",
                )

            order.shipped_at = now
            for item in items:
                if item.status not in ("cancelled", "returned"):
                    item.status = "shipped"
                    session.add(item)

            if not shipment:
                shipment = Shipment(
                    order_id=order.id,
                    site_id=site_id,
                    mode="manual",
                    status="shipped",
                    delivery_partner_name=payload.delivery_partner_name,
                    delivery_partner_phone=payload.delivery_partner_phone,
                    awb_number=payload.delivery_partner_phone,
                    courier_name=payload.delivery_partner_name,
                    estimated_delivery_at=payload.estimated_delivery_at,
                    shipped_at=now,
                )
            else:
                shipment.status = "shipped"
                if payload.delivery_partner_name is not None:
                    shipment.delivery_partner_name = payload.delivery_partner_name
                if payload.delivery_partner_phone is not None:
                    shipment.delivery_partner_phone = payload.delivery_partner_phone
                    shipment.awb_number = payload.delivery_partner_phone
                if payload.estimated_delivery_at is not None:
                    shipment.estimated_delivery_at = payload.estimated_delivery_at
                shipment.shipped_at = now
            session.add(shipment)

        elif payload.status == "out_for_delivery":
            # Guard: ensure an agent or partner is assigned
            has_partner = bool(
                payload.delivery_partner_name
                or (shipment and (shipment.agent_id or shipment.delivery_partner_name or shipment.courier_name))
            )
            if not has_partner:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot move order to Out for Delivery without assigning a Delivery Agent or Courier Partner first. Please dispatch or assign a rider."
                )

            order.shipped_at = order.shipped_at or now
            for item in items:
                if item.status not in ("cancelled", "returned"):
                    item.status = "out_for_delivery"
                    session.add(item)

            if not shipment:
                shipment = Shipment(
                    order_id=order.id,
                    site_id=site_id,
                    mode="manual",
                    status="out_for_delivery",
                    delivery_partner_name=payload.delivery_partner_name,
                    delivery_partner_phone=payload.delivery_partner_phone,
                    awb_number=payload.delivery_partner_phone,
                    courier_name=payload.delivery_partner_name,
                    estimated_delivery_at=payload.estimated_delivery_at,
                    out_for_delivery_at=now,
                )
            else:
                shipment.status = "out_for_delivery"
                if payload.delivery_partner_name is not None:
                    shipment.delivery_partner_name = payload.delivery_partner_name
                if payload.delivery_partner_phone is not None:
                    shipment.delivery_partner_phone = payload.delivery_partner_phone
                    shipment.awb_number = payload.delivery_partner_phone
                if payload.estimated_delivery_at is not None:
                    shipment.estimated_delivery_at = payload.estimated_delivery_at
                shipment.out_for_delivery_at = now
            session.add(shipment)

        elif payload.status == "delivered":
            has_partner = bool(
                payload.delivery_partner_name
                or (shipment and (shipment.agent_id or shipment.delivery_partner_name or shipment.courier_name))
            )
            if not has_partner:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot mark order Delivered without an assigned delivery agent or courier partner."
                )
            from datetime import timedelta
            order.delivered_at = now

            order_items = session.exec(
                select(OrderItem).where(OrderItem.order_id == order.id)
            ).all()
            site = session.get(Site, order.site_id)
            site_default = getattr(site, "default_return_window_days", 7) if site else 7
            max_days = max(
                (
                    it.return_window_days if getattr(it, "return_window_days", None) is not None else site_default
                    for it in order_items
                    if it.status != "cancelled"
                ),
                default=0,
            )

            if max_days == 0:
                order.return_window_closes_at = now
                order.escrow_status = "unheld"
            else:
                order.return_window_closes_at = now + timedelta(days=max_days)
                order.escrow_status = "held"

            ledger_entry = session.exec(
                select(TenantLedgerEntry).where(TenantLedgerEntry.order_id == order.id)
            ).first()
            if ledger_entry:
                ledger_entry.escrow_release_due_at = order.return_window_closes_at
                if max_days == 0:
                    ledger_entry.escrow_status = "unheld"
                    ledger_entry.status = "paid"
                    ledger_entry.settled_at = now
                if getattr(order, "payment_method", "").lower() in ("cod", "cash_on_delivery"):
                    order.payment_status = "paid"
                    ledger_entry.status = "paid"
                session.add(ledger_entry)

            if not shipment:
                shipment = Shipment(
                    order_id=order.id,
                    site_id=site_id,
                    status="delivered",
                    delivered_at=now,
                )
            else:
                shipment.status = "delivered"
                shipment.delivered_at = now
            session.add(shipment)

            for item in items:
                if item.status != "cancelled":
                    item.status = "delivered"
                    item.returnable_quantity = item.quantity
                    item.updated_at = now
                    session.add(item)

        elif payload.status == "cancelled":
            if previous_status == "delivered":
                raise HTTPException(status_code=400, detail="Delivered order cannot be cancelled from this endpoint")

            order.cancelled_at = now
            order.cancel_reason = payload.cancel_reason

            # If order was paid online, initiate refund and update ledger
            if getattr(order, "payment_status", None) == "paid":
                if order.razorpay_payment_id and not order.razorpay_payment_id.startswith("pay_mock_"):
                    try:
                        from routers.payments import get_razorpay_client
                        client = get_razorpay_client()
                        if client:
                            refund_amount_paise = int(Decimal(str(order.total)) * 100)
                            refund_resp = client.payment.refund(
                                order.razorpay_payment_id,
                                {
                                    "amount": refund_amount_paise,
                                    "reverse_all": 1,
                                    "notes": {"reason": "Admin cancellation refund"},
                                },
                            )
                            if isinstance(refund_resp, dict):
                                snapshot = dict(order.pricing_snapshot or {})
                                snapshot["refund_details"] = {
                                    "refund_id": refund_resp.get("id"),
                                    "status": refund_resp.get("status", "processed"),
                                    "amount": (refund_resp.get("amount") or refund_amount_paise) / 100,
                                    "arn": refund_resp.get("acquirer_data", {}).get("arn") if isinstance(refund_resp.get("acquirer_data"), dict) else None,
                                    "created_at": refund_resp.get("created_at"),
                                }
                                order.pricing_snapshot = snapshot
                    except Exception as rerr:
                        print(f"Razorpay refund warning on admin cancellation: {rerr}")

                order.payment_status = "refunded"

                ledger_entry = session.exec(
                    select(TenantLedgerEntry).where(TenantLedgerEntry.order_id == order.id)
                ).first()
                if ledger_entry:
                    ledger_entry.status = "refunded"
                    session.add(ledger_entry)

            for item in items:
                if item.status == "cancelled":
                    continue

                product = session.exec(
                    select(Product)
                    .where(Product.id == item.product_id, Product.site_id == site_id)
                    .with_for_update()
                ).first()

                if not product:
                    raise HTTPException(status_code=404, detail=f"Product not found for order item {item.id}")

                increment_product_stock(product, item.quantity, item.selected_variant_value)
                session.add(product)

                item.status = "cancelled"
                item.updated_at = now
                session.add(item)

                movement = InventoryMovement(
                    site_id=site_id,
                    product_id=item.product_id,
                    order_id=order.id,
                    order_item_id=item.id,
                    movement_type="cancel_restock",
                    quantity_delta=item.quantity,
                    note=f"Stock restored for cancelled order {order.id}",
                )
                session.add(movement)

            # Cancel associated shipment & trigger Shiprocket cancellation/RTO if applicable
            shipments = session.exec(
                select(Shipment).where(Shipment.order_id == order.id)
            ).all()
            for sh in shipments:
                if sh.agent_id and sh.status not in ("delivered", "failed", "returned_to_warehouse", "cancelled"):
                    agent = session.get(DeliveryAgent, sh.agent_id)
                    if agent:
                        agent.current_order_count = max(0, agent.current_order_count - 1)
                        session.add(agent)
                sh.status = "cancelled"
                sh.notes = f"{sh.notes or ''} [Cancelled by admin: {payload.cancel_reason or 'Admin cancelled'}]".strip()
                session.add(sh)
                if getattr(sh, "delivery_mode", None) == "shiprocket" or getattr(sh, "mode", None) == "shiprocket":
                    try:
                        from routers.delivery import _get_or_refresh_shiprocket_token
                        del_settings = session.exec(
                            select(DeliverySettings).where(DeliverySettings.site_id == site_id)
                        ).first()
                        if del_settings and del_settings.shiprocket_email:
                            sr_token = _get_or_refresh_shiprocket_token(del_settings, session)
                            if sr_token:
                                if getattr(sh, "courier_order_id", None):
                                    ShiprocketClient.cancel_order(sr_token, [sh.courier_order_id])
                                if getattr(sh, "awb_number", None):
                                    ShiprocketClient.cancel_shipment_by_awb(sr_token, [sh.awb_number])
                    except Exception as sr_err:
                        print(f"Shiprocket order cancellation error on admin action: {sr_err}")

        if payload.status in {"confirmed", "shipped", "out_for_delivery"}:
            for item in items:
                if item.status != "cancelled":
                    item.status = payload.status
                    item.updated_at = now
                    session.add(item)

        order.updated_at = now
        session.add(order)

        session.add(
            OrderStatusHistory(
                order_id=order.id,
                status=payload.status,
                changed_by=UUID(admin["adminId"]),
                changed_by_type="admin",
            )
        )

        session.commit()

        try:
            action_name = "order.cancelled" if payload.status == "cancelled" else "order.status_changed"
            summary_text = (
                f"Cancelled order #{str(order.id)[:8]}" + (f": {payload.cancel_reason}" if payload.cancel_reason else "")
                if payload.status == "cancelled"
                else f"Changed status of order #{str(order.id)[:8]} from '{previous_status}' to '{payload.status}'"
            )
            admin_uuid = UUID(admin["adminId"]) if admin.get("adminId") else None
            log_activity(
                session=session,
                admin_id=admin_uuid,
                user_id=admin_uuid,
                action=action_name,
                category="orders",
                site_id=site_id,
                resource_type="order",
                resource_id=str(order.id),
                resource_name=f"Order #{str(order.id)[:8]}",
                summary=summary_text,
                description=summary_text,
                details={
                    "order_id": str(order.id),
                    "before": {"status": previous_status},
                    "after": {
                        "status": payload.status,
                        "cancel_reason": payload.cancel_reason if payload.status == "cancelled" else None,
                    },
                },
                request=request,
                actor_email=admin.get("email"),
                actor_name=admin.get("name") or admin.get("email"),
                actor_role=admin.get("role") or "Staff",
            )
        except Exception as log_err:
            logger.warning(f"Failed to record activity log for order status update: {log_err}")
    except HTTPException:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise

    return {
        "message": "Order status updated successfully",
        "order_id": str(order.id),
        "status": order.status,
    }


# =========================
# CUSTOMER ROUTES AFTER ADMIN ROUTES
# =========================


@router.post("/{site_id}/place")
def place_order(
    site_id: UUID,
    payload: PlaceOrderRequest,
    user=Depends(authenticate_customer),
    session: Session = Depends(get_session),
):
    site = get_site_or_404(session, site_id)
    if not getattr(site, "is_online", True):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Store is temporarily offline for maintenance. New orders cannot be placed at this time.",
        )

    if str(site_id) != user["siteId"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Customer token does not match requested site",
        )

    customer = get_user_for_site_or_404(session, site_id, UUID(user["userId"]))
    cart = get_cart_for_user_or_404(session, site_id, customer.id)
    address = get_address_for_user_or_404(session, site_id, customer.id, payload.address_id)

    # Deliverability check for delivery radius
    delivery_settings = session.exec(
        select(DeliverySettings).where(DeliverySettings.site_id == site_id)
    ).first()
    if delivery_settings:
        store_lat = getattr(delivery_settings, "sender_latitude", None)
        store_lng = getattr(delivery_settings, "sender_longitude", None)
        delivery_mode = delivery_settings.delivery_mode or "manual"

        ef = getattr(delivery_settings, "enable_fleet", None)
        es = getattr(delivery_settings, "enable_shiprocket", None)
        is_fleet = bool(ef) if ef is not None else (delivery_mode in ("own_agent", "hybrid"))
        is_sr = bool(es) if es is not None else (delivery_mode in ("shiprocket", "hybrid"))

        fleet_radius_km = float(delivery_settings.own_delivery_radius_km or 10)
        sr_radius_raw = getattr(delivery_settings, "shiprocket_delivery_radius_km", None)
        sr_radius_km = float(sr_radius_raw) if (sr_radius_raw is not None and float(sr_radius_raw) > 0) else None

        if store_lat is not None and store_lng is not None:
            cust_lat = getattr(address, "latitude", None)
            cust_lng = getattr(address, "longitude", None)
            if cust_lat is not None and cust_lng is not None:
                # Haversine distance in km
                R = 6371.0
                phi1, phi2 = math.radians(store_lat), math.radians(cust_lat)
                dphi = math.radians(cust_lat - store_lat)
                dlambda = math.radians(cust_lng - store_lng)
                a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
                dist = R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

                if is_sr:
                    if sr_radius_km is not None:
                        effective_max = max(sr_radius_km, fleet_radius_km if is_fleet else 0.0)
                        if dist > effective_max:
                            raise HTTPException(
                                status_code=400,
                                detail="Sorry, we currently do not deliver to this address. Please choose a different delivery location.",
                            )
                elif is_fleet:
                    if dist > fleet_radius_km:
                        raise HTTPException(
                            status_code=400,
                            detail="Sorry, we currently do not deliver to this address. Please choose a different delivery location.",
                        )

    cart_items = session.exec(
        select(CartItem).where(CartItem.cart_id == cart.id)
    ).all()

    if not cart_items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    payment_method = normalize_payment_method(payload.payment_method)
    checkout_settings = site.checkout_settings or build_default_checkout_settings()

    order_line_items: list[dict[str, Any]] = []
    product_map: dict[UUID, Product] = {}

    try:
        for cart_item in cart_items:
            product = session.exec(
                select(Product)
                .where(Product.id == cart_item.product_id, Product.site_id == site_id)
                .with_for_update()
            ).first()

            if not product:
                raise HTTPException(status_code=404, detail=f"Product not found for cart item {cart_item.id}")

            if not product.in_stock or product.stock <= 0:
                raise HTTPException(status_code=409, detail=f"{product.name} is out of stock")

            unit_price, compare_price, selected_variant_label, available_stock = extract_variant_details(
                product,
                cart_item.selected_variant_value,
            )

            if cart_item.quantity > available_stock:
                raise HTTPException(
                    status_code=409,
                    detail=f"Requested quantity exceeds available stock for {product.name}",
                )

            product_image = None
            if product.images and len(product.images) > 0:
                product_image = product.images[0]

            line_total = money(unit_price * cart_item.quantity)

            order_line_items.append(
                {
                    "cart_item_id": cart_item.id,
                    "product_id": product.id,
                    "product_name": cart_item.product_name or product.name,
                    "product_slug": cart_item.product_slug or product.slug,
                    "product_image": cart_item.product_image or product_image,
                    "selected_variant_label": cart_item.selected_variant_label or selected_variant_label,
                    "selected_variant_value": cart_item.selected_variant_value,
                    "unit_price": unit_price,
                    "compare_price": compare_price,
                    "quantity": cart_item.quantity,
                    "line_total": line_total,
                }
            )
            product_map[product.id] = product

        pricing_snapshot = evaluate_pricing(
            cart_items=order_line_items,
            checkout_settings=checkout_settings,
            payment_method=payment_method,
            selected_optional_charge_ids=payload.selected_optional_charge_ids,
            promo_code=payload.promo_code,
            site_id=site_id,
            session=session,
            customer_email=customer.email,
        )

        applied_coupon_code = pricing_snapshot.get("promoCode")
        applied_discount_amount = money(Decimal(str(pricing_snapshot.get("promoDiscount", 0))))

        order = Order(
            site_id=site_id,
            customer_id=customer.id,
            shipping_address_id=address.id,
            shipping_address=serialize_address_snapshot(address),
            items=[
                {
                    "product_id": str(item["product_id"]),
                    "product_name": item["product_name"],
                    "product_slug": item["product_slug"],
                    "product_image": item["product_image"],
                    "selected_variant_label": item["selected_variant_label"],
                    "selected_variant_value": item["selected_variant_value"],
                    "unit_price": float(item["unit_price"]),
                    "compare_price": float(item["compare_price"]) if item["compare_price"] is not None else None,
                    "quantity": item["quantity"],
                    "line_total": float(item["line_total"]),
                }
                for item in order_line_items
            ],
            pricing_snapshot=pricing_snapshot,
            payment_method=payment_method,
            coupon_code=applied_coupon_code,
            discount_amount=applied_discount_amount,
            status="placed",
            delivery_otp=f"{secrets.randbelow(9000) + 1000}",
            total=money(pricing_snapshot["total"]),
        )
        session.add(order)
        session.flush()

        # Atomically record coupon usage & increment usage counter
        if applied_coupon_code and pricing_snapshot.get("couponId"):
            try:
                coupon_uuid = UUID(str(pricing_snapshot["couponId"]))
                coupon_rec = session.get(Coupon, coupon_uuid)
                if coupon_rec:
                    coupon_rec.times_used += 1
                    session.add(coupon_rec)
                    usage = CouponUsage(
                        site_id=site_id,
                        coupon_id=coupon_rec.id,
                        order_id=order.id,
                        user_id=customer.id,
                        customer_email=customer.email or "",
                        discount_amount=applied_discount_amount,
                    )
                    session.add(usage)
            except Exception as e:
                logger.warning(f"Failed to record coupon usage: {e}")

        order_subtotal = sum((item["line_total"] for item in order_line_items), Decimal("0.00"))

        for item in order_line_items:
            product = product_map[item["product_id"]]
            decrement_product_stock(product, item["quantity"], item["selected_variant_value"])
            session.add(product)

            item_return_days = product.return_window_days if product.return_window_days is not None else getattr(site, "default_return_window_days", 7)

            order_item = OrderItem(
                order_id=order.id,
                site_id=site_id,
                product_id=item["product_id"],
                product_name=item["product_name"],
                product_slug=item["product_slug"],
                product_image=item["product_image"],
                selected_variant_label=item["selected_variant_label"],
                selected_variant_value=item["selected_variant_value"],
                unit_price=item["unit_price"],
                compare_price=item["compare_price"],
                quantity=item["quantity"],
                line_total=item["line_total"],
                status="placed",
                returnable_quantity=0,
                return_window_days=item_return_days,
                pricing_snapshot=build_order_item_pricing_snapshot(
                    line_total=item["line_total"],
                    quantity=item["quantity"],
                    order_subtotal=order_subtotal,
                    pricing_snapshot=pricing_snapshot,
                ),
            )
            session.add(order_item)
            session.flush()

            movement = InventoryMovement(
                site_id=site_id,
                product_id=item["product_id"],
                order_id=order.id,
                order_item_id=order_item.id,
                movement_type="sale",
                quantity_delta=-item["quantity"],
                note=f"Stock deducted for order {order.id}",
            )
            session.add(movement)

        status_history = OrderStatusHistory(
            order_id=order.id,
            status="placed",
            changed_by=customer.id,
            changed_by_type="customer",
        )
        session.add(status_history)

        session.exec(delete(CartItem).where(CartItem.cart_id == cart.id))
        cart.updated_at = utc_now()
        session.add(cart)

        session.commit()
        session.refresh(order)

        return {
            "message": "Order placed successfully",
            "order_id": str(order.id),
            "status": order.status,
            "total": float(order.total),
            "pricing_snapshot": order.pricing_snapshot,
        }
    except HTTPException:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise


def build_customer_refund_info(
    order: Order,
    allow_live_check: bool = False,
    session: Optional[Session] = None,
) -> Optional[dict[str, Any]]:
    # Extract refund transactions from pricing_snapshot
    snapshot = (order.pricing_snapshot or {}) if isinstance(order.pricing_snapshot, dict) else {}
    refund_history = list(snapshot.get("refund_history") or [])
    if not refund_history and snapshot.get("refund_details"):
        refund_history.append(snapshot.get("refund_details"))

    total_refunded_amount = 0.0
    latest_tx: Optional[dict[str, Any]] = None
    for rf in refund_history:
        if isinstance(rf, dict) and rf.get("amount") is not None:
            try:
                amt = float(rf.get("amount") or 0)
                total_refunded_amount += amt
                latest_tx = rf
            except (ValueError, TypeError):
                pass

    is_cod = (order.payment_method or "").lower() in {"cod", "cash_on_delivery", "cash on delivery"}
    is_fully_refunded = (
        order.status == "refunded"
        or getattr(order, "payment_status", None) == "refunded"
        or (total_refunded_amount > 0 and total_refunded_amount >= float(order.total or 0))
    )
    is_partially_refunded = (
        getattr(order, "payment_status", None) == "partially_refunded"
        or (total_refunded_amount > 0 and total_refunded_amount < float(order.total or 0))
    )

    now = utc_now()
    initiated_dt = order.cancelled_at or order.updated_at or order.created_at

    # CASE A: Refund transactions exist OR order is marked refunded/partially refunded
    if total_refunded_amount > 0 or is_fully_refunded or is_partially_refunded:
        display_amount = total_refunded_amount if total_refunded_amount > 0 else float(order.total or 0)
        status_label = "Refunded" if is_fully_refunded else "Partially Refunded"
        ref_id = (latest_tx.get("reference_id") or latest_tx.get("refund_id")) if latest_tx else getattr(order, "razorpay_payment_id", None)
        payout_mode = latest_tx.get("payout_mode") if latest_tx else None

        if is_cod:
            payout_desc = payout_mode or "UPI / Bank Transfer"
            return {
                "status": "completed",
                "status_label": status_label,
                "badge_color": "emerald",
                "amount": round(display_amount, 2),
                "payment_method": f"Cash on Delivery ({payout_desc})",
                "reference_id": ref_id,
                "arn": None,
                "estimated_days": "Completed",
                "note": f"A refund of ₹{display_amount:.2f} has been disbursed via {payout_desc}." + (f" (Ref: {ref_id})" if ref_id else ""),
                "initiated_at": (latest_tx.get("created_at") if latest_tx else None) or (initiated_dt.isoformat() if initiated_dt else None),
            }
        else:
            refund_id = (latest_tx.get("refund_id") or latest_tx.get("reference_id") or order.razorpay_payment_id) if latest_tx else order.razorpay_payment_id
            refund_arn = latest_tx.get("arn") if latest_tx else None
            gateway_status = (latest_tx.get("status") if latest_tx else None) or "processed"

            return {
                "status": "completed",
                "status_label": status_label,
                "badge_color": "emerald",
                "amount": round(display_amount, 2),
                "payment_method": order.payment_method or "Online Payment",
                "reference_id": refund_id,
                "arn": refund_arn,
                "estimated_days": "Completed",
                "note": f"A refund of ₹{display_amount:.2f} has been processed and credited to your original payment source.",
                "initiated_at": (latest_tx.get("created_at") if latest_tx else None) or (initiated_dt.isoformat() if initiated_dt else None),
            }

    # CASE B: Order is cancelled without monetary refund
    if order.status == "cancelled":
        if is_cod:
            return {
                "status": "not_applicable",
                "status_label": "No refund needed",
                "badge_color": "slate",
                "amount": 0.0,
                "payment_method": "Cash on Delivery",
                "reference_id": None,
                "arn": None,
                "estimated_days": None,
                "note": "No payment was collected for this Cash on Delivery order.",
                "initiated_at": None,
            }
        else:
            return {
                "status": "processing",
                "status_label": "Refund in progress",
                "badge_color": "amber",
                "amount": float(order.total),
                "payment_method": order.payment_method or "Online Payment",
                "reference_id": order.razorpay_payment_id,
                "arn": None,
                "estimated_days": "2-4 business days",
                "note": f"A refund of ₹{float(order.total):.2f} is being processed to your original payment source.",
                "initiated_at": initiated_dt.isoformat() if initiated_dt else None,
            }

    return None


def _resolve_site_uuid(site_id_or_slug: str, session: Session) -> UUID:
    try:
        return UUID(str(site_id_or_slug))
    except (ValueError, TypeError):
        site = session.exec(select(Site).where(Site.slug == str(site_id_or_slug))).first()
        if site:
            return site.id
        raise HTTPException(status_code=404, detail="Store not found")


@router.get("/{site_id}/my-orders")
def get_my_orders(
    site_id: str,
    page: Optional[int] = Query(None, ge=1, description="Page number"),
    page_size: Optional[int] = Query(None, ge=1, le=100, description="Orders per page"),
    user=Depends(authenticate_customer),
    session: Session = Depends(get_session),
):
    resolved_site_id = _resolve_site_uuid(site_id, session)
    user_id_uuid = UUID(user["userId"])
    customer = session.get(User, user_id_uuid)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer account not found")

    user_addr_ids = session.exec(select(UserAddress.id).where(UserAddress.user_id == customer.id)).all()

    conditions = [Order.customer_id == customer.id]
    if user_addr_ids:
        conditions.append(Order.shipping_address_id.in_(user_addr_ids))
    if customer.email:
        cust_e = customer.email.strip().lower()
        conditions.append(cast(Order.shipping_address, String).ilike(f"%{cust_e}%"))
    if customer.phone:
        clean_phone = customer.phone.strip().replace(" ", "").replace("-", "")
        if len(clean_phone) >= 10:
            p10 = clean_phone[-10:]
            conditions.append(cast(Order.shipping_address, String).ilike(f"%{p10}%"))

    base_query = select(Order).where(
        Order.site_id == resolved_site_id,
        or_(*conditions),
        Order.status != "pending",
    )

    total_count = 0
    total_pages = 1

    if page is not None and page_size is not None:
        count_query = select(func.count()).select_from(base_query.subquery())
        total_count = session.exec(count_query).one() or 0
        total_pages = (total_count + page_size - 1) // page_size if total_count > 0 else 1

        paginated_query = (
            base_query.order_by(Order.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        orders = session.exec(paginated_query).all()
    else:
        orders = session.exec(base_query.order_by(Order.created_at.desc())).all()

    order_ids = [order.id for order in orders]
    items_map: dict[UUID, list[OrderItem]] = {}
    shipment_map: dict[UUID, Shipment] = {}

    if order_ids:
        order_items = session.exec(
            select(OrderItem)
            .where(OrderItem.order_id.in_(order_ids))
            .order_by(OrderItem.id.asc())
        ).all()
        for item in order_items:
            items_map.setdefault(item.order_id, []).append(item)

        shipments = session.exec(
            select(Shipment)
            .where(Shipment.order_id.in_(order_ids))
            .order_by(Shipment.created_at.desc())
        ).all()
        for sh in shipments:
            if sh.order_id not in shipment_map:
                shipment_map[sh.order_id] = sh

    response = []
    for order in orders:
        sh = shipment_map.get(order.id)
        effective_order_status = order.status
        if sh and order.status not in ("cancelled", "refunded", "returned"):
            sh_st = getattr(sh, "status", None)
            if sh_st == "delivered":
                effective_order_status = "delivered"
            elif sh_st in ("out_for_delivery", "picked_up"):
                effective_order_status = "out_for_delivery"
            elif sh_st in ("shipped", "in_transit"):
                effective_order_status = "shipped"
            elif sh_st in ("assigned", "accepted") and effective_order_status == "placed":
                effective_order_status = "confirmed"

            if order.status != effective_order_status:
                order.status = effective_order_status
                if effective_order_status == "out_for_delivery" and not order.shipped_at:
                    order.shipped_at = sh.shipped_at or sh.out_for_delivery_at or order.confirmed_at or order.created_at
                elif effective_order_status == "shipped" and not order.shipped_at:
                    order.shipped_at = sh.shipped_at or order.confirmed_at or order.created_at
                elif effective_order_status == "confirmed" and not order.confirmed_at:
                    order.confirmed_at = order.created_at
                session.add(order)
                try:
                    session.commit()
                except Exception:
                    session.rollback()

        serialized_items = [
            serialize_customer_order_item(item, effective_order_status)
            for item in items_map.get(order.id, [])
        ]
        has_returnable_items = any(item["is_returnable"] for item in serialized_items)
        sh_mode = getattr(sh, "delivery_mode", None) or getattr(sh, "mode", None)
        is_own_agent = bool(
            sh
            and (
                sh_mode == "own_agent"
                or bool(getattr(sh, "agent_id", None))
                or (bool(getattr(sh, "delivery_partner_name", None)) and sh_mode != "manual" and not getattr(sh, "awb_number", None))
            )
        )
        is_out_for_delivery = bool(
            effective_order_status == "out_for_delivery"
            or (sh and getattr(sh, "status", None) in ("out_for_delivery", "picked_up"))
        )

        response.append(
            {
                "id": str(order.id),
                "status": effective_order_status,
                "payment_status": get_effective_payment_status(order),
                "total": float(order.total),
                "payment_method": order.payment_method,
                "razorpay_payment_id": order.razorpay_payment_id,
                "razorpay_order_id": order.razorpay_order_id,
                "shipping_address": get_effective_shipping_address(order, session),
                "created_at": order.created_at.isoformat() if order.created_at else None,
                "confirmed_at": order.confirmed_at.isoformat() if order.confirmed_at else None,
                "shipped_at": order.shipped_at.isoformat() if order.shipped_at else None,
                "delivered_at": order.delivered_at.isoformat() if order.delivered_at else None,
                "cancelled_at": order.cancelled_at.isoformat() if order.cancelled_at else None,
                "items": serialized_items,
                "pricing_snapshot": order.pricing_snapshot,
                "delivery_otp": ensure_order_delivery_otp(order, session) if (is_own_agent and is_out_for_delivery) else None,
                "shipment": serialize_shipment(sh, effective_order_status, session=session),
                "has_returnable_items": has_returnable_items,
                "can_request_return": effective_order_status == "delivered" and has_returnable_items,
                "cancel_reason": getattr(order, "cancel_reason", None),
                "refund_info": build_customer_refund_info(order),
            }
        )

    if page is not None and page_size is not None:
        return {
            "orders": response,
            "total": total_count,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    return response


@router.get("/{site_id}/delivered")
def get_my_delivered_orders(
    site_id: UUID,
    user=Depends(authenticate_customer),
    session: Session = Depends(get_session),
):
    user_id_uuid = UUID(user["userId"])
    customer = session.get(User, user_id_uuid)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer account not found")

    delivered_orders = session.exec(
        select(Order)
        .where(
            Order.site_id == site_id,
            Order.customer_id == customer.id,
            Order.status == "delivered",
        )
        .order_by(Order.created_at.desc())
    ).all()

    order_ids = [order.id for order in delivered_orders]
    items_map: dict[UUID, list[OrderItem]] = {}

    if order_ids:
        order_items = session.exec(
            select(OrderItem)
            .where(OrderItem.order_id.in_(order_ids))
            .order_by(OrderItem.id.asc())
        ).all()
        for item in order_items:
            items_map.setdefault(item.order_id, []).append(item)

    response = []
    for order in delivered_orders:
        serialized_items = [
            serialize_customer_order_item(item, order.status)
            for item in items_map.get(order.id, [])
        ]
        response.append(
            {
                "id": str(order.id),
                "status": order.status,
                "total": float(order.total),
                "payment_method": order.payment_method,
                "created_at": order.created_at.isoformat() if order.created_at else None,
                "items": serialized_items,
            }
        )

    return {"orders": response}


@router.get("/{site_id}/my-orders/{order_id}")
def get_my_order_detail(
    site_id: str,
    order_id: UUID,
    user=Depends(authenticate_customer),
    session: Session = Depends(get_session),
):
    resolved_site_id = _resolve_site_uuid(site_id, session)
    user_id_uuid = UUID(user["userId"])
    customer = session.get(User, user_id_uuid)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer account not found")

    order = session.get(Order, order_id)
    if not order or order.site_id != resolved_site_id:
        raise HTTPException(status_code=404, detail="Order not found")

    shipping_addr = get_effective_shipping_address(order, session)
    order_email = (shipping_addr.get("email") or "").strip().lower()
    order_phone = (shipping_addr.get("mobileNumber") or shipping_addr.get("mobile_number") or shipping_addr.get("phone") or "").strip().replace(" ", "").replace("-", "")
    cust_email = (customer.email or "").strip().lower()
    cust_phone = (customer.phone or "").strip().replace(" ", "").replace("-", "")

    user_addr_ids = session.exec(select(UserAddress.id).where(UserAddress.user_id == customer.id)).all()

    is_owner = (
        (order.customer_id == customer.id)
        or (getattr(order, "shipping_address_id", None) in user_addr_ids)
        or (cust_email and order_email and cust_email == order_email)
        or (cust_phone and order_phone and (cust_phone == order_phone or cust_phone.endswith(order_phone[-10:]) or order_phone.endswith(cust_phone[-10:])))
    )
    if not is_owner:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.customer_id is None:
        order.customer_id = customer.id
        session.add(order)
        try:
            session.commit()
        except Exception:
            session.rollback()

    items = session.exec(
        select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.id.asc())
    ).all()

    # Self-heal items if order is delivered but individual items were never updated
    if order.status == "delivered":
        has_changes = False
        for item in items:
            if item.status not in ("delivered", "returned", "cancelled"):
                item.status = "delivered"
                if item.returnable_quantity is None:
                    item.returnable_quantity = item.quantity
                has_changes = True
                session.add(item)
        if has_changes:
            try:
                session.commit()
            except Exception:
                session.rollback()

    _sync_order_return_status(order, session, items)
    try:
        session.commit()
    except Exception:
        session.rollback()

    shipment = session.exec(
        select(Shipment).where(Shipment.order_id == order.id)
    ).first()

    effective_order_status = order.status
    if shipment and order.status not in ("cancelled", "refunded", "returned"):
        sh_st = getattr(shipment, "status", None)
        if sh_st == "delivered":
            effective_order_status = "delivered"
        elif sh_st in ("out_for_delivery", "picked_up"):
            effective_order_status = "out_for_delivery"
        elif sh_st in ("shipped", "in_transit"):
            effective_order_status = "shipped"
        elif sh_st in ("assigned", "accepted") and effective_order_status == "placed":
            effective_order_status = "confirmed"

        if order.status != effective_order_status:
            order.status = effective_order_status
            if effective_order_status == "out_for_delivery" and not order.shipped_at:
                order.shipped_at = shipment.shipped_at or shipment.out_for_delivery_at or order.confirmed_at or order.created_at
            elif effective_order_status == "shipped" and not order.shipped_at:
                order.shipped_at = shipment.shipped_at or order.confirmed_at or order.created_at
            elif effective_order_status == "confirmed" and not order.confirmed_at:
                order.confirmed_at = order.created_at
            session.add(order)
            try:
                session.commit()
            except Exception:
                session.rollback()

    serialized_items = [serialize_customer_order_item(item, effective_order_status) for item in items]
    has_returnable_items = any(item["is_returnable"] for item in serialized_items)

    sh_mode = getattr(shipment, "delivery_mode", None) or getattr(shipment, "mode", None)
    is_own_agent = bool(
        shipment
        and (
            sh_mode == "own_agent"
            or bool(getattr(shipment, "agent_id", None))
            or (bool(getattr(shipment, "delivery_partner_name", None)) and sh_mode != "manual" and not getattr(shipment, "awb_number", None))
        )
    )
    is_out_for_delivery = bool(
        effective_order_status == "out_for_delivery"
        or (shipment and getattr(shipment, "status", None) in ("out_for_delivery", "picked_up"))
    )

    return {
        "id": str(order.id),
        "status": effective_order_status,
        "payment_status": get_effective_payment_status(order),
        "total": float(order.total),
        "payment_method": order.payment_method,
        "razorpay_payment_id": order.razorpay_payment_id,
        "razorpay_order_id": order.razorpay_order_id,
        "shipping_address": shipping_addr,
        "pricing_snapshot": order.pricing_snapshot,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "confirmed_at": order.confirmed_at.isoformat() if order.confirmed_at else None,
        "shipped_at": order.shipped_at.isoformat() if order.shipped_at else None,
        "delivered_at": order.delivered_at.isoformat() if order.delivered_at else None,
        "cancelled_at": order.cancelled_at.isoformat() if order.cancelled_at else None,
        "items": serialized_items,
        "shipment": serialize_shipment(shipment, effective_order_status, session=session),
        "delivery_otp": ensure_order_delivery_otp(order, session) if (is_own_agent and is_out_for_delivery) else None,
        "has_returnable_items": has_returnable_items,
        "can_request_return": effective_order_status == "delivered" and has_returnable_items,
        "cancel_reason": getattr(order, "cancel_reason", None),
        "refund_info": build_customer_refund_info(order, allow_live_check=True, session=session),
    }


@router.post("/{site_id}/{order_id}/cancel")
def cancel_my_order(
    site_id: UUID,
    order_id: UUID,
    payload: CancelOrderRequest,
    user=Depends(authenticate_customer),
    session: Session = Depends(get_session),
):
    user_id_uuid = UUID(user["userId"])
    customer = session.get(User, user_id_uuid)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer account not found")

    customer_email = customer.email

    order = session.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    is_owner = (
        (order.customer_id == customer.id) or
        (customer_email and isinstance(order.shipping_address, dict) and order.shipping_address.get("email") == customer_email)
    )
    if not is_owner:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.status in {"delivered", "returned", "cancelled"}:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel order that is already {order.status.replace('_', ' ')}. Please use return request for delivered orders.",
        )

    items = session.exec(
        select(OrderItem).where(OrderItem.order_id == order.id)
    ).all()

    now = utc_now()

    try:
        for item in items:
            if item.status == "cancelled":
                continue

            product = session.exec(
                select(Product)
                .where(Product.id == item.product_id, Product.site_id == site_id)
                .with_for_update()
            ).first()

            if not product:
                raise HTTPException(status_code=404, detail=f"Product not found for order item {item.id}")

            increment_product_stock(product, item.quantity, item.selected_variant_value)
            session.add(product)

            item.status = "cancelled"
            item.updated_at = now
            session.add(item)

            session.add(
                InventoryMovement(
                    site_id=site_id,
                    product_id=item.product_id,
                    order_id=order.id,
                    order_item_id=item.id,
                    movement_type="cancel_restock",
                    quantity_delta=item.quantity,
                    note=f"Customer cancelled order {order.id}",
                )
            )

        order.status = "cancelled"
        order.cancel_reason = payload.cancel_reason
        order.cancelled_at = now
        order.updated_at = now

        # Cancel associated shipment & trigger Shiprocket cancellation/RTO if applicable
        shipments = session.exec(
            select(Shipment).where(Shipment.order_id == order.id)
        ).all()
        for sh in shipments:
            sh.status = "cancelled"
            cancel_msg = f"Cancelled by customer: {payload.cancel_reason or 'No reason provided'}"
            existing_notes = sh.notes or ""
            if cancel_msg not in existing_notes:
                sh.notes = f"{existing_notes} [{cancel_msg}]".strip()
            session.add(sh)
            if getattr(sh, "delivery_mode", None) == "shiprocket" or getattr(sh, "mode", None) == "shiprocket":
                try:
                    from routers.delivery import _get_or_refresh_shiprocket_token
                    del_settings = session.exec(
                        select(DeliverySettings).where(DeliverySettings.site_id == site_id)
                    ).first()
                    if del_settings and del_settings.shiprocket_email:
                        sr_token = _get_or_refresh_shiprocket_token(del_settings, session)
                        if sr_token:
                            if getattr(sh, "courier_order_id", None):
                                ShiprocketClient.cancel_order(sr_token, [sh.courier_order_id])
                            if getattr(sh, "awb_number", None):
                                ShiprocketClient.cancel_shipment_by_awb(sr_token, [sh.awb_number])
                except Exception as sr_err:
                    logger.warning("Shiprocket order cancellation error (non-fatal): %s", sr_err)

        # If order was paid online, initiate refund and update ledger
        refund_succeeded = False
        if getattr(order, "payment_status", None) == "paid":
            if order.razorpay_payment_id and not order.razorpay_payment_id.startswith("pay_mock_"):
                try:
                    from routers.payments import get_razorpay_client
                    client = get_razorpay_client()
                    if client:
                        refund_amount_paise = int(Decimal(str(order.total)) * 100)
                        refund_resp = client.payment.refund(
                            order.razorpay_payment_id,
                            {
                                "amount": refund_amount_paise,
                                "reverse_all": 1,
                                "notes": {"reason": "Customer cancellation refund"},
                            },
                        )
                        if isinstance(refund_resp, dict):
                            snapshot = dict(order.pricing_snapshot or {})
                            snapshot["refund_details"] = {
                                "refund_id": refund_resp.get("id"),
                                "status": refund_resp.get("status", "processed"),
                                "amount": (refund_resp.get("amount") or refund_amount_paise) / 100,
                                "arn": refund_resp.get("acquirer_data", {}).get("arn") if isinstance(refund_resp.get("acquirer_data"), dict) else None,
                                "created_at": refund_resp.get("created_at"),
                            }
                            order.pricing_snapshot = snapshot
                            flag_modified(order, "pricing_snapshot")
                            refund_succeeded = True
                except Exception as rerr:
                    logger.error("Razorpay refund FAILED on customer cancellation for order %s: %s", order.id, rerr)
                    refund_succeeded = False
            else:
                # Mock payment or no payment_id -- mark as refunded directly
                refund_succeeded = True

            order.payment_status = "refunded" if refund_succeeded else "refund_pending"

            ledger_entry = session.exec(
                select(TenantLedgerEntry).where(TenantLedgerEntry.order_id == order.id)
            ).first()
            if ledger_entry:
                ledger_entry.status = "refunded" if refund_succeeded else "refund_pending"
                session.add(ledger_entry)

        session.add(order)

        session.add(
            OrderStatusHistory(
                order_id=order.id,
                status="cancelled",
                changed_by=customer.id,
                changed_by_type="customer",
            )
        )

        session.commit()
        return {
            "message": "Order cancelled successfully",
            "order_id": str(order.id),
            "status": order.status,
            "refund_amount": float(order.total),
        }
    except HTTPException:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        raise


@router.delete("/{site_id}/{order_id}/draft")
def discard_unpaid_order(
    site_id: UUID,
    order_id: UUID,
    user=Depends(authenticate_customer),
    session: Session = Depends(get_session),
):
    user_id_uuid = UUID(user["userId"])
    customer = session.get(User, user_id_uuid)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer account not found")

    order = session.get(Order, order_id)
    if not order or order.site_id != site_id or order.customer_id != customer.id:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.status == "pending" and (order.payment_status == "pending" or not order.payment_status):
        session.delete(order)
        session.commit()
        return {"message": "Draft order session discarded"}

    return {"message": "Order is not in pending state"}