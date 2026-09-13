import React, { useEffect, useState } from "react";
import { API_BASE_URL } from "../config/api";

export interface ValidatedCoupon {
  id?: string;
  code: string;
  discountType: "percentage" | "fixed_amount" | "free_shipping";
  discountValue: number;
  discountAmount: number;
  message?: string;
}

export interface AvailableCoupon {
  id: string;
  code: string;
  description?: string;
  discountType: "percentage" | "fixed_amount" | "free_shipping";
  discountValue: number;
  maxDiscountAmount?: number | null;
  appliesTo?: "all" | "collections" | "categories";
  collectionIds?: string[];
  categoryIds?: string[];
  minOrderValue: number;
  isFirstOrderOnly: boolean;
  expiresAt?: string | null;
}

interface PromoCodeInputProps {
  siteId: string;
  subtotal: number;
  cartItems?: Array<{
    id?: string | number;
    product_id?: string | number;
    price?: number;
    quantity?: number;
    category_id?: string | null;
    category?: string | null;
    category_name?: string | null;
    collections?: Array<{ id: string; name?: string }>;
    [key: string]: any;
  }>;
  deliveryFee?: number;
  customerEmail?: string;
  appliedCoupon: ValidatedCoupon | null;
  onCouponApplied: (coupon: ValidatedCoupon) => void;
  onCouponRemoved: () => void;
  accentColor?: string;
  textColor?: string;
  cardBg?: string;
  inputBg?: string;
  borderColor?: string;
}

// Helper to determine if a background/text color is dark
function isColorDark(color?: string): boolean {
  if (!color) return true;
  const hex = color.replace("#", "").trim();
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
  }
  if (color.startsWith("rgb")) {
    const m = color.match(/\d+/g);
    if (m && m.length >= 3) {
      return (Number(m[0]) * 299 + Number(m[1]) * 587 + Number(m[2]) * 114) / 1000 < 128;
    }
  }
  return false;
}

export const PromoCodeInput: React.FC<PromoCodeInputProps> = ({
  siteId,
  subtotal,
  cartItems = [],
  deliveryFee = 0,
  customerEmail = "",
  appliedCoupon,
  onCouponApplied,
  onCouponRemoved,
  accentColor = "#2563eb",
  textColor = "#0f172a",
  cardBg = "#ffffff",
  inputBg = "#f8fafc",
  borderColor = "rgba(0, 0, 0, 0.1)",
}) => {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [removeHover, setRemoveHover] = useState(false);

  // Available Public Coupons State
  const [availableCoupons, setAvailableCoupons] = useState<AvailableCoupon[]>([]);
  const [showOffers, setShowOffers] = useState(false);
  const [applyingCode, setApplyingCode] = useState<string | null>(null);

  const isDark = isColorDark(cardBg) || isColorDark(inputBg) || !isColorDark(textColor);

  // Dynamic Theme-Aware Palette
  const cardBackground = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.025)";
  const cardBorder = isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(15, 23, 42, 0.08)";
  const savingsTextColor = isDark ? "#34d399" : "#059669"; // High contrast emerald for both light & dark
  const removeTextColor = removeHover
    ? "#ef4444"
    : isDark
    ? "rgba(255, 255, 255, 0.55)"
    : "rgba(15, 23, 42, 0.55)";

  // Format cart items payload for validation
  const serializedCartItems = (cartItems || []).map((item) => ({
    product_id: String(item.id || item.product_id || ""),
    id: String(item.id || item.product_id || ""),
    price: Number(item.price || 0),
    quantity: Number(item.quantity || 1),
    category_id: item.category_id || null,
    category: item.category || item.category_name || null,
    category_name: item.category_name || item.category || null,
    collections: item.collections || [],
  }));

  // Fetch available public coupons on mount / siteId change
  useEffect(() => {
    if (!siteId) return;
    let isCancelled = false;

    const fetchAvailable = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/coupons/available/${siteId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!isCancelled && Array.isArray(data.coupons)) {
          setAvailableCoupons(data.coupons);
        }
      } catch {}
    };

    fetchAvailable();
    return () => {
      isCancelled = true;
    };
  }, [siteId]);

  const handleApply = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!code.trim()) {
      setErrorMsg("Please enter a promo code");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch(`${API_BASE_URL}/coupons/validate/${siteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          subtotal: subtotal,
          delivery_fee: deliveryFee,
          customer_email: customerEmail,
          cart_items: serializedCartItems,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.valid) {
        throw new Error(data.message || data.detail || "Invalid or ineligible promo code");
      }

      const validated: ValidatedCoupon = {
        id: data.coupon?.id,
        code: data.coupon?.code || code.trim().toUpperCase(),
        discountType: data.coupon?.discountType || "fixed_amount",
        discountValue: data.coupon?.discountValue || 0,
        discountAmount: data.discountAmount || 0,
        message: data.message,
      };

      onCouponApplied(validated);
      setSuccessMsg(data.message || `Code '${validated.code}' applied!`);
      setCode("");
      setShowOffers(false);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to validate promo code");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickApply = async (targetCode: string) => {
    setApplyingCode(targetCode);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch(`${API_BASE_URL}/coupons/validate/${siteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          code: targetCode.trim().toUpperCase(),
          subtotal: subtotal,
          delivery_fee: deliveryFee,
          customer_email: customerEmail,
          cart_items: serializedCartItems,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.valid) {
        throw new Error(data.message || data.detail || "Ineligible promo code");
      }

      const validated: ValidatedCoupon = {
        id: data.coupon?.id,
        code: data.coupon?.code || targetCode.trim().toUpperCase(),
        discountType: data.coupon?.discountType || "fixed_amount",
        discountValue: data.coupon?.discountValue || 0,
        discountAmount: data.discountAmount || 0,
        message: data.message,
      };

      onCouponApplied(validated);
      setSuccessMsg(data.message || `Code '${validated.code}' applied!`);
      setCode("");
      setShowOffers(false);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to apply promo code");
    } finally {
      setApplyingCode(null);
    }
  };

  const handleRemove = () => {
    onCouponRemoved();
    setErrorMsg("");
    setSuccessMsg("");
  };

  return (
    <div style={{ width: "100%", margin: "10px 0" }}>
      {appliedCoupon ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 12px",
            background: cardBackground,
            border: `1px solid ${cardBorder}`,
            borderRadius: "10px",
            transition: "all 0.2s ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
            {/* Theme-colored Ticket Icon */}
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                background: `${accentColor}18`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: accentColor,
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: "15px", height: "15px" }}
              >
                <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
                <path d="M13 5v2" />
                <path d="M13 17v2" />
                <path d="M13 11v2" />
              </svg>
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                <span
                  style={{
                    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
                    fontWeight: 800,
                    fontSize: "13px",
                    color: textColor,
                    letterSpacing: "0.05em",
                  }}
                >
                  {appliedCoupon.code}
                </span>

                {/* Theme-Aware Discount Pill */}
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: "5px",
                    background: `${accentColor}18`,
                    color: accentColor,
                    letterSpacing: "0.02em",
                  }}
                >
                  {appliedCoupon.discountType === "percentage"
                    ? `${appliedCoupon.discountValue}% OFF`
                    : appliedCoupon.discountType === "free_shipping"
                    ? "Free Delivery"
                    : `₹${appliedCoupon.discountValue} OFF`}
                </span>
              </div>

              <div
                style={{
                  fontSize: "11.5px",
                  fontWeight: 600,
                  color: savingsTextColor,
                  marginTop: "2px",
                }}
              >
                {appliedCoupon.discountType === "free_shipping"
                  ? "Delivery charge waived"
                  : `You save ₹${appliedCoupon.discountAmount.toFixed(2)}`}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRemove}
            onMouseEnter={() => setRemoveHover(true)}
            onMouseLeave={() => setRemoveHover(false)}
            style={{
              background: removeHover ? (isDark ? "rgba(239, 68, 68, 0.12)" : "rgba(239, 68, 68, 0.08)") : "transparent",
              border: "none",
              color: removeTextColor,
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              padding: "5px 8px",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              transition: "all 0.15s ease",
              flexShrink: 0,
            }}
          >
            <span>✕</span>
            <span>Remove</span>
          </button>
        </div>
      ) : (
        <form onSubmit={handleApply} style={{ width: "100%" }}>
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <input
                type="text"
                placeholder="Enter promo code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setErrorMsg("");
                }}
                style={{
                  width: "100%",
                  height: "40px",
                  boxSizing: "border-box",
                  background: inputBg,
                  border: `1px solid ${errorMsg ? "#ef4444" : borderColor}`,
                  borderRadius: "10px",
                  padding: "0 12px",
                  color: textColor,
                  fontSize: "13.5px",
                  fontFamily: "monospace",
                  fontWeight: 700,
                  outline: "none",
                  letterSpacing: "0.05em",
                }}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !code.trim()}
              style={{
                height: "40px",
                padding: "0 16px",
                background: accentColor,
                color: "#ffffff",
                border: "none",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: 700,
                cursor: loading || !code.trim() ? "not-allowed" : "pointer",
                opacity: loading || !code.trim() ? 0.6 : 1,
                transition: "all 0.15s ease",
                whiteSpace: "nowrap",
              }}
            >
              {loading ? "Applying..." : "Apply"}
            </button>
          </div>

          {errorMsg && (
            <div style={{ marginTop: "6px", fontSize: "12px", color: "#f87171", display: "flex", alignItems: "center", gap: "4px" }}>
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div style={{ marginTop: "6px", fontSize: "12px", color: savingsTextColor, display: "flex", alignItems: "center", gap: "4px" }}>
              <span>{successMsg}</span>
            </div>
          )}

          {/* View Available Public Offers Expandable List */}
          {availableCoupons.length > 0 && (
            <div style={{ marginTop: "8px" }}>
              <button
                type="button"
                onClick={() => setShowOffers((prev) => !prev)}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: "4px 0",
                  color: accentColor,
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <span>{showOffers ? "Hide Available Offers" : `View Available Offers (${availableCoupons.length})`}</span>
                <span
                  style={{
                    fontSize: "9px",
                    display: "inline-block",
                    transition: "transform 0.2s ease",
                    transform: showOffers ? "rotate(180deg)" : "rotate(0deg)",
                  }}
                >
                  ▼
                </span>
              </button>

              {showOffers && (
                <div
                  style={{
                    marginTop: "8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    maxHeight: "240px",
                    overflowY: "auto",
                    paddingRight: "2px",
                  }}
                >
                  {availableCoupons.map((coupon) => {
                    const isMinOrderMet = subtotal >= coupon.minOrderValue;
                    const diffToMin = Math.max(0, coupon.minOrderValue - subtotal);
                    const isApplying = applyingCode === coupon.code;

                    return (
                      <div
                        key={coupon.id}
                        style={{
                          padding: "10px 12px",
                          borderRadius: "9px",
                          background: cardBackground,
                          border: `1px solid ${cardBorder}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "10px",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                            <span
                              style={{
                                fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
                                fontWeight: 800,
                                fontSize: "12.5px",
                                color: textColor,
                                letterSpacing: "0.05em",
                              }}
                            >
                              {coupon.code}
                            </span>
                            <span
                              style={{
                                fontSize: "10.5px",
                                fontWeight: 700,
                                padding: "1.5px 6px",
                                borderRadius: "4px",
                                background: `${accentColor}18`,
                                color: accentColor,
                              }}
                            >
                              {coupon.discountType === "percentage"
                                ? `${coupon.discountValue}% OFF`
                                : coupon.discountType === "free_shipping"
                                ? "Free Delivery"
                                : `₹${coupon.discountValue} OFF`}
                            </span>

                            {coupon.appliesTo === "collections" ? (
                              <span
                                style={{
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  padding: "1px 5px",
                                  borderRadius: "3px",
                                  background: "rgba(124, 58, 237, 0.12)",
                                  color: isDark ? "#c4b5fd" : "#7c3aed",
                                }}
                              >
                                Specific Collections
                              </span>
                            ) : coupon.appliesTo === "categories" ? (
                              <span
                                style={{
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  padding: "1px 5px",
                                  borderRadius: "3px",
                                  background: "rgba(8, 145, 178, 0.12)",
                                  color: isDark ? "#67e8f9" : "#0891b2",
                                }}
                              >
                                Specific Categories
                              </span>
                            ) : null}
                          </div>

                          <div style={{ fontSize: "11px", color: isDark ? "rgba(255,255,255,0.6)" : "rgba(15,23,42,0.6)", marginTop: "3px", lineHeight: 1.3 }}>
                            {coupon.description ? coupon.description : null}
                            {coupon.minOrderValue > 0 && (
                              <span>
                                {coupon.description ? " • " : ""}
                                {isMinOrderMet
                                  ? `Min order ₹${coupon.minOrderValue}`
                                  : `Add ₹${diffToMin.toFixed(0)} more to unlock`}
                              </span>
                            )}
                            {coupon.isFirstOrderOnly && (
                              <span> • 1st order only</span>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={isApplying}
                          onClick={() => handleQuickApply(coupon.code)}
                          style={{
                            height: "28px",
                            padding: "0 12px",
                            borderRadius: "6px",
                            border: `1px solid ${accentColor}`,
                            background: isMinOrderMet ? accentColor : "transparent",
                            color: isMinOrderMet ? "#ffffff" : accentColor,
                            fontSize: "11.5px",
                            fontWeight: 700,
                            cursor: isApplying ? "not-allowed" : "pointer",
                            opacity: isApplying ? 0.6 : 1,
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                            transition: "all 0.15s ease",
                          }}
                        >
                          {isApplying ? "Applying..." : "Apply"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </form>
      )}
    </div>
  );
};

export default PromoCodeInput;
