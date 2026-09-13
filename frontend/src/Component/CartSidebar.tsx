import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCart } from "../CartContext";
import { API_BASE_URL } from "../config/api";
import { isColorDarkHex } from "../context/ThemeContext";
import { getThumbnailUrl } from "../utils/imageOptimizer";
import PromoCodeInput, { ValidatedCoupon } from "./PromoCodeInput";
import { useDeviceMode } from "../context/DeviceModeContext";

type CartTheme = {
  name?: string;
  mode?: string;
  primary_bg?: string;
  text_color?: string;
  accent_color?: string;
  festival_theme?: string;
};

type CartSidebarProps = {
  mode?: "cart" | "checkout_summary";
  title?: string;
  empty_title?: string;
  empty_message?: string;
  clear_label?: string;
  remove_label?: string;
  promo_title?: string;
  promo_placeholder?: string;
  promo_button_label?: string;
  summary_title?: string;
  checkout_label?: string;
  shipping_label?: string;
  tax_label?: string;
  subtotal_label?: string;
  total_label?: string;
  note?: string;
  show_promo?: boolean;
  show_summary?: boolean;
  show_items?: boolean;
  show_gift_card?: boolean;
  review_mode?: boolean;
  max_width?: number | string;
  min_height?: number;
  border_radius?: number;
  card_radius?: number;
  background_color?: string;
  panel_color?: string;
  card_color?: string;
  text_color?: string;
  muted_text_color?: string;
  border_color?: string;
  accent_color?: string;
  theme?: CartTheme;
  accentColor?: string;
  paymentMethod?: string;
  appliedCoupon?: ValidatedCoupon | null;
  onCouponApplied?: (coupon: ValidatedCoupon) => void;
  onCouponRemoved?: () => void;
  embeddedInEditorWrapper?: boolean;
};

type ChargeCode =
  | "shipping_fee"
  | "handling_fee"
  | "packaging_fee"
  | "service_fee"
  | "platform_fee"
  | "small_order_fee"
  | "cod_fee"
  | "gift_wrap"
  | "custom";

type ChargeRule = {
  id: string;
  code: ChargeCode | string;
  label: string;
  enabled: boolean;
  optional: boolean;
  customerSelectable: boolean;
  refundable?: boolean;
  amountType: "fixed" | "percent";
  amountValue: string;
  applyConditionType: "none" | "subtotal_lt" | "subtotal_gte" | "payment_method";
  applyConditionValue: string;
  waiveConditionType: "none" | "subtotal_gte";
  waiveConditionValue: string;
  description?: string;
};

type TaxSettings = {
  enabled: boolean;
  label: string;
  rate: string;
  applyOnShipping: boolean;
};

type CheckoutSettingsResponse = {
  charges: ChargeRule[];
  taxSettings: TaxSettings;
};

type AppliedCharge = ChargeRule & {
  calculatedAmount: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHex(hex?: string) {
  if (!hex) return null;
  const cleaned = hex.trim().replace("#", "");
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return `#${cleaned
      .split("")
      .map((char) => char + char)
      .join("")
      .toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned.toLowerCase()}`;
  }
  return null;
}

function hexToRgb(hex?: string) {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const value = normalized.slice(1);
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return { r, g, b };
}

function rgbToHex(r: number, g: number, b: number) {
  const toHex = (value: number) =>
    clamp(Math.round(value), 0, 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mixHex(colorA: string, colorB: string, weight = 0.5) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);

  if (!a && !b) return "#000000";
  if (!a) return colorB;
  if (!b) return colorA;

  const w = clamp(weight, 0, 1);

  return rgbToHex(
    a.r + (b.r - a.r) * w,
    a.g + (b.g - a.g) * w,
    a.b + (b.b - a.b) * w
  );
}

function alpha(hex: string, opacity: number) {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(255,255,255,${opacity})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp(opacity, 0, 1)})`;
}

function getContrastingText(bgHex: string, preferredText?: string): string {
  if (!bgHex || typeof bgHex !== "string") return preferredText || "#0f172a";
  const rgb = hexToRgb(bgHex);
  if (!rgb) return preferredText || "#0f172a";
  const isBgDark = (rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114) < 160;

  if (preferredText && typeof preferredText === "string" && preferredText.startsWith("#")) {
    const textRgb = hexToRgb(preferredText);
    if (textRgb) {
      const isTextDark = (textRgb.r * 0.299 + textRgb.g * 0.587 + textRgb.b * 0.114) < 160;
      if (isBgDark !== isTextDark) {
        return preferredText;
      }
    }
  }

  return isBgDark ? "#ffffff" : "#0f172a";
}

function toNumber(value?: string | number | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePaymentMethod(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function matchesApplyCondition(
  charge: ChargeRule,
  subtotalAfterDiscount: number,
  paymentMethod: string
) {
  switch (charge.applyConditionType) {
    case "none":
      return true;
    case "subtotal_lt":
      return subtotalAfterDiscount < toNumber(charge.applyConditionValue);
    case "subtotal_gte":
      return subtotalAfterDiscount >= toNumber(charge.applyConditionValue);
    case "payment_method":
      return (
        normalizePaymentMethod(charge.applyConditionValue) ===
        normalizePaymentMethod(paymentMethod)
      );
    default:
      return true;
  }
}

function isChargeWaived(charge: ChargeRule, subtotalAfterDiscount: number) {
  switch (charge.waiveConditionType) {
    case "subtotal_gte":
      return subtotalAfterDiscount >= toNumber(charge.waiveConditionValue);
    case "none":
    default:
      return false;
  }
}

function calculateChargeAmount(charge: ChargeRule, baseAmount: number) {
  const raw = toNumber(charge.amountValue);
  if (charge.amountType === "percent") {
    return Math.max(0, Math.round((baseAmount * raw) / 100));
  }
  return Math.max(0, Math.round(raw));
}

const ChargeInfoTooltip: React.FC<{
  text: string;
  palette: any;
}> = ({ text, palette }) => {
  const [hover, setHover] = useState(false);
  if (!text) return null;

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        marginLeft: "5px",
        verticalAlign: "middle",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        setHover((prev) => !prev);
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "15px",
          height: "15px",
          borderRadius: "50%",
          fontSize: "9.5px",
          fontWeight: 700,
          background: hover ? palette.text : palette.softBg,
          color: hover ? palette.cardBg : palette.textMuted,
          border: `1px solid ${palette.cardBorder}`,
          cursor: "pointer",
          userSelect: "none",
          transition: "all 0.15s ease",
          lineHeight: 1,
        }}
      >
        i
      </span>

      {hover && (
        <span
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: "0",
            transform: "translateX(-15%)",
            background: "#0f172a",
            color: "#f8fafc",
            fontSize: "11px",
            fontWeight: 500,
            padding: "6px 10px",
            borderRadius: "7px",
            whiteSpace: "normal",
            wordBreak: "break-word",
            boxShadow: "0 8px 20px rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.15)",
            zIndex: 1000,
            pointerEvents: "none",
            lineHeight: 1.35,
            width: "max-content",
            maxWidth: "200px",
            textAlign: "left",
            boxSizing: "border-box",
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
};

const FreeShippingProgress: React.FC<{
  subtotal: number;
  threshold: number;
  remaining: number;
  shippingWaived: boolean;
  accentColor: string;
  palette: any;
}> = ({ subtotal, threshold, remaining, shippingWaived, accentColor, palette }) => {
  if (!threshold || threshold <= 0) return null;
  const isUnlocked = shippingWaived || remaining <= 0;
  const progressPercent = Math.min(100, Math.max(0, Math.round((subtotal / threshold) * 100)));

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "12px",
        background: isUnlocked ? palette.successBg : palette.softBg,
        border: `1px solid ${isUnlocked ? "rgba(34, 197, 94, 0.25)" : palette.cardBorder}`,
        marginBottom: "14px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600 }}>
          <span style={{ color: isUnlocked ? palette.successText : palette.text }}>
            {isUnlocked ? (
              "You have unlocked Free Delivery!"
            ) : (
              <>
                Add <strong style={{ color: accentColor }}>₹{remaining}</strong> more for <strong>Free Delivery</strong>
              </>
            )}
          </span>
        </div>
        <span style={{ fontSize: "11.5px", fontWeight: 700, color: isUnlocked ? palette.successText : palette.textMuted }}>
          {progressPercent}%
        </span>
      </div>

      {/* Progress Track */}
      <div
        style={{
          width: "100%",
          height: "6px",
          borderRadius: "999px",
          background: isUnlocked ? "rgba(34, 197, 94, 0.2)" : "rgba(0, 0, 0, 0.08)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progressPercent}%`,
            borderRadius: "999px",
            background: isUnlocked
              ? "linear-gradient(90deg, #22c55e, #16a34a)"
              : `linear-gradient(90deg, ${accentColor}, ${accentColor})`,
            transition: "width 0.35s ease",
          }}
        />
      </div>
    </div>
  );
};

const CartSidebar: React.FC<CartSidebarProps> = ({
  mode = "cart",
  title,
  empty_title,
  empty_message,
  clear_label,
  remove_label,
  promo_title,
  promo_placeholder,
  promo_button_label,
  summary_title,
  checkout_label,
  shipping_label,
  tax_label,
  subtotal_label,
  total_label,
  note,
  show_promo = true,
  show_summary = true,
  show_items = true,
  show_gift_card = true,
  review_mode = false,
  max_width,
  min_height,
  border_radius,
  card_radius,
  background_color,
  panel_color,
  card_color,
  text_color,
  muted_text_color,
  border_color,
  accent_color,
  theme,
  accentColor,
  paymentMethod,
  appliedCoupon: propAppliedCoupon,
  onCouponApplied: propOnCouponApplied,
  onCouponRemoved: propOnCouponRemoved,
  embeddedInEditorWrapper,
}) => {
  const {
    cartItems,
    updateQuantity,
    removeFromCart,
    clearCart,
    appliedCoupon: cartContextCoupon,
    setAppliedCoupon: setCartContextCoupon,
    clearAppliedCoupon,
  } = useCart();
  const { siteId, slug } = useParams();

  const appliedCoupon = propAppliedCoupon !== undefined ? propAppliedCoupon : cartContextCoupon;
  const handleCouponApplied = (coupon: ValidatedCoupon) => {
    setCartContextCoupon(coupon);
    propOnCouponApplied?.(coupon);
  };
  const handleCouponRemoved = () => {
    clearAppliedCoupon();
    propOnCouponRemoved?.();
  };

  const [screenSize, setScreenSize] = useState<{ isMobile: boolean; isTablet: boolean }>(() => {
    if (typeof window === "undefined") return { isMobile: false, isTablet: false };
    const w = window.innerWidth;
    return { isMobile: w < 768, isTablet: w >= 768 && w < 1024 };
  });
  const [checkoutSettings, setCheckoutSettings] =
    useState<CheckoutSettingsResponse | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [selectedOptionalChargeIds, setSelectedOptionalChargeIds] = useState<
    string[]
  >([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let timeoutId: any = null;
    const checkBreakpoints = () => {
      const w = window.innerWidth;
      const nextMobile = w < 768;
      const nextTablet = w >= 768 && w < 1024;
      setScreenSize((prev) => {
        if (prev.isMobile === nextMobile && prev.isTablet === nextTablet) {
          return prev;
        }
        return { isMobile: nextMobile, isTablet: nextTablet };
      });
    };

    const debouncedResize = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(checkBreakpoints, 150);
    };

    window.addEventListener("resize", debouncedResize, { passive: true });
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener("resize", debouncedResize);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const loadCheckoutSettings = async () => {
      try {
        let url = "";

        if (siteId) {
          url = `${API_BASE_URL}/sites/${siteId}/checkout-settings`;
        } else if (slug) {
          url = `${API_BASE_URL}/store/${slug}/checkout-settings`;
        } else {
          return;
        }

        setSettingsLoading(true);

        const response = await fetch(url, {
          signal: controller.signal,
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(`Failed to load checkout settings: ${response.status}`);
        }

        const data: CheckoutSettingsResponse = await response.json();
        setCheckoutSettings(data);

        setSelectedOptionalChargeIds((prev) => {
          if (prev.length > 0) return prev;

          return (data.charges || [])
            .filter(
              (charge) =>
                charge.enabled && charge.customerSelectable && charge.optional
            )
            .map((charge) => charge.id);
        });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("Checkout settings load failed", error);
        }
      } finally {
        setSettingsLoading(false);
      }
    };

    loadCheckoutSettings();

    return () => controller.abort();
  }, [siteId, slug]);

  const deviceMode = useDeviceMode();
  const isMobile = deviceMode === "mobile" || screenSize.isMobile;
  const isTablet = deviceMode === "mobile" ? false : screenSize.isTablet;
  const isCheckoutSummary = mode === "checkout_summary";

  const shouldShowItems = show_items && !review_mode;
  const shouldShowPromo = show_promo && !review_mode;
  const shouldShowGiftCard = show_gift_card && !review_mode;

  const checkoutPath = slug
    ? `/store/${slug}/checkout`
    : siteId
    ? `/builder/${siteId}/checkout`
    : "/admin/sites";

  const explorePath = slug
    ? `/store/${slug}`
    : siteId
    ? `/builder/${siteId}`
    : "/";

  const heading = title || (isCheckoutSummary ? "Order summary" : "Your cart");
  const emptyHeading = empty_title || "Your cart is empty";
  const emptyText = empty_message || "Add a few products to see them here.";
  const clearText = clear_label || "Clear cart";
  const removeText = remove_label || "Remove";
  const promoTitle = promo_title || "Promo code";
  const promoPlaceholder = promo_placeholder || "Enter code";
  const promoButtonLabel = promo_button_label || "Apply";
  const summaryTitle = summary_title || "Order summary";
  const checkoutLabel = checkout_label || "Proceed to checkout";
  const shippingLabel = shipping_label || "Shipping";
  const fallbackTaxLabel = tax_label || "Tax";
  const subtotalLabel = subtotal_label || "Subtotal";
  const totalLabel = total_label || "Total";
  const footerNote = note || (isCheckoutSummary ? "" : "Final charges will be validated at checkout.");

  const isDark =
    theme?.mode === "dark" ||
    (background_color ? isColorDarkHex(background_color) : false) ||
    (panel_color ? isColorDarkHex(panel_color) : false) ||
    (theme?.primary_bg ? isColorDarkHex(theme.primary_bg) : false);

  const resolvedAccentColor =
    accent_color ||
    accentColor ||
    (isCheckoutSummary ? (theme as any)?.summary_accent_color : (theme as any)?.cart_accent_color) ||
    theme?.accent_color ||
    "#7c3aed";

  const resolvedPrimaryBg =
    background_color ||
    (isCheckoutSummary ? (theme as any)?.summary_bg : (theme as any)?.cart_bg) ||
    theme?.primary_bg ||
    (isDark ? "#0b1020" : "#f8fafc");

  const resolvedTextColor =
    text_color ||
    (isCheckoutSummary ? (theme as any)?.summary_text_color : (theme as any)?.cart_text_color) ||
    theme?.text_color ||
    (isDark ? "#e5e7eb" : "#0f172a");

  const hasFestiveTint = Boolean(theme?.festival_theme);

  const parseSafeNum = (val: any, fallback: number) => {
    if (val === undefined || val === null || val === "") return fallback;
    const n = Number(val);
    return isNaN(n) ? fallback : n;
  };

  const resolveMaxWidthStyle = (val: any, fallback = "1280px") => {
    if (!val) return fallback;
    const str = String(val).trim();
    if (str === "100%" || str === "full" || str === "100") return "100%";
    if (str.endsWith("px") || str.endsWith("%")) return str;
    const num = Number(str);
    if (!isNaN(num)) {
      return num <= 100 ? `${num}%` : `${num}px`;
    }
    return fallback;
  };

  const outerRadius = clamp(parseSafeNum(border_radius, 24), 0, 40);
  const innerRadius = clamp(parseSafeNum(card_radius, 18), 0, 32);
  const resolvedMaxWidth = resolveMaxWidthStyle(max_width, "1280px");
  const resolvedMinHeight = clamp(
    parseSafeNum(min_height, 380),
    280,
    650
  );

  const palette = useMemo(() => {
    const pageBg = resolvedPrimaryBg;

    const dynamicShellBorder =
      border_color ||
      (isCheckoutSummary ? (theme as any)?.summary_border_color : (theme as any)?.cart_border_color) ||
      (isDark ? "rgba(255, 255, 255, 0.14)" : "rgba(15, 23, 42, 0.09)");

    const dynamicCardBorder =
      border_color ||
      (isCheckoutSummary ? (theme as any)?.summary_border_color : (theme as any)?.cart_border_color) ||
      (isDark ? "rgba(255, 255, 255, 0.11)" : "rgba(15, 23, 42, 0.07)");

    if (!isDark) {
      const shellBg =
        panel_color ||
        background_color ||
        (isCheckoutSummary ? (theme as any)?.summary_bg : (theme as any)?.cart_bg) ||
        "#ffffff";
      const panelBg =
        panel_color ||
        background_color ||
        (isCheckoutSummary ? (theme as any)?.summary_bg : (theme as any)?.cart_panel_bg || (theme as any)?.cart_bg) ||
        mixHex(pageBg, "#ffffff", 0.7);
      const cardBg =
        card_color ||
        (isCheckoutSummary ? (theme as any)?.summary_card_bg : (theme as any)?.cart_card_bg) ||
        "#ffffff";

      const cardText = getContrastingText(
        cardBg,
        text_color ||
          (isCheckoutSummary ? (theme as any)?.summary_text_color : (theme as any)?.cart_text_color) ||
          theme?.text_color ||
          "#0f172a"
      );

      return {
        pageBg,
        shellBg,
        shellBorder: dynamicShellBorder,
        headerBg: shellBg,
        panelBg,
        cardBg,
        cardBorder: dynamicCardBorder,
        mutedBg: mixHex(pageBg, "#000000", 0.03),
        softBg: alpha(cardText, 0.04),
        text: cardText,
        textMuted: muted_text_color || mixHex(cardText, cardBg, 0.4),
        textSoft: muted_text_color || mixHex(cardText, cardBg, 0.25),
        danger: "#dc2626",
        successBg: alpha("#22c55e", 0.10),
        successText: "#166534",
        inputBg: cardBg,
        quantityBg: mixHex(pageBg, "#000000", 0.02),
        shadow: alpha(cardText, 0.06) ? `0 8px 20px ${alpha("#0f172a", 0.06)}` : "none",
        cardShadow: `0 4px 14px ${alpha("#0f172a", 0.04)}`,
        disabledBg: mixHex(cardText, cardBg, 0.5),
      };
    }

    const shellBg =
      panel_color ||
      background_color ||
      (theme as any)?.cart_panel_bg ||
      (theme as any)?.cart_bg ||
      (hasFestiveTint
        ? mixHex(pageBg, "#ffffff", 0.09)
        : mixHex(pageBg, "#ffffff", 0.07));
    const panelBg =
      panel_color ||
      background_color ||
      (theme as any)?.cart_panel_bg ||
      (theme as any)?.cart_bg ||
      (hasFestiveTint
        ? mixHex(pageBg, "#ffffff", 0.13)
        : mixHex(pageBg, "#ffffff", 0.10));
    const cardBg =
      card_color ||
      (theme as any)?.cart_card_bg ||
      (hasFestiveTint
        ? mixHex(mixHex(pageBg, "#ffffff", 0.16), resolvedAccentColor, 0.08)
        : mixHex(pageBg, "#ffffff", 0.14));
    const mutedBg = mixHex(pageBg, "#000000", 0.12);
    const inputBg = card_color || mixHex(pageBg, "#000000", 0.15);
    const quantityBg = mixHex(pageBg, "#000000", 0.12);

    const cardText = getContrastingText(cardBg, text_color || (theme as any)?.cart_text_color || (theme as any)?.card_text_color || theme?.text_color || "#e5e7eb");

    return {
      pageBg,
      shellBg,
      shellBorder: dynamicShellBorder,
      headerBg: shellBg,
      panelBg,
      cardBg,
      cardBorder: dynamicCardBorder,
      mutedBg,
      softBg: alpha("#ffffff", 0.05),
      text: cardText,
      textMuted:
        muted_text_color || mixHex(cardText, cardBg, 0.45),
      textSoft:
        muted_text_color || mixHex(cardText, cardBg, 0.28),
      danger: "#fda4af",
      successBg: alpha("#22c55e", 0.16),
      successText: "#86efac",
      inputBg,
      quantityBg,
      shadow: "0 10px 24px rgba(0,0,0,0.18)",
      cardShadow: "0 2px 10px rgba(0,0,0,0.10)",
      disabledBg: mixHex(resolvedTextColor, pageBg, 0.5),
    };
  }, [
    isDark,
    resolvedPrimaryBg,
    resolvedTextColor,
    resolvedAccentColor,
    hasFestiveTint,
    background_color,
    panel_color,
    card_color,
    border_color,
    muted_text_color,
  ]);

  const totalItems = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const isCouponFreeShipping = appliedCoupon?.discountType === "free_shipping";
  const promoDiscount = appliedCoupon && !isCouponFreeShipping ? appliedCoupon.discountAmount : 0;

  const subtotalAfterDiscount = Math.max(subtotal - promoDiscount, 0);
  const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);

  const enabledCharges = (checkoutSettings?.charges || []).filter(
    (charge) => charge.enabled
  );

  const optionalSelectableCharges = enabledCharges.filter(
    (charge) => charge.customerSelectable && charge.optional
  );

  const autoAppliedCharges = enabledCharges.filter(
    (charge) => !(charge.customerSelectable && charge.optional)
  );

  const selectedOptionalCharges = optionalSelectableCharges.filter((charge) =>
    selectedOptionalChargeIds.includes(charge.id)
  );

  const applicableCharges: AppliedCharge[] = [
    ...autoAppliedCharges,
    ...selectedOptionalCharges,
  ]
    .filter((charge) =>
      matchesApplyCondition(charge, subtotalAfterDiscount, normalizedPaymentMethod)
    )
    .filter((charge) => !isChargeWaived(charge, subtotalAfterDiscount))
    .map((charge) => ({
      ...charge,
      calculatedAmount: calculateChargeAmount(charge, subtotalAfterDiscount),
    }))
    .filter((charge) => charge.calculatedAmount > 0);

  const shippingRule =
    enabledCharges.find((charge) => charge.code === "shipping_fee") || null;

  const shippingCharge =
    applicableCharges.find((charge) => charge.code === "shipping_fee")
      ?.calculatedAmount || 0;

  const nonShippingCharges = applicableCharges.filter(
    (charge) => charge.code !== "shipping_fee"
  );

  const chargesBeforeTax =
    shippingCharge +
    nonShippingCharges.reduce((sum, charge) => sum + charge.calculatedAmount, 0);

  const taxSettings = checkoutSettings?.taxSettings;
  const taxBase = taxSettings?.applyOnShipping
    ? subtotalAfterDiscount + chargesBeforeTax
    : subtotalAfterDiscount;

  const tax =
    taxSettings?.enabled
      ? Math.max(0, Math.round((taxBase * toNumber(taxSettings.rate)) / 100))
      : 0;

  const total = Math.max(subtotalAfterDiscount + chargesBeforeTax + tax, 0);

  const shippingWaived = Boolean(
    shippingRule && isChargeWaived(shippingRule, subtotalAfterDiscount)
  );

  const freeShippingThreshold =
    shippingRule?.waiveConditionType === "subtotal_gte"
      ? toNumber(shippingRule.waiveConditionValue)
      : 0;

  const remainingForFreeShipping =
    freeShippingThreshold > 0
      ? Math.max(freeShippingThreshold - subtotalAfterDiscount, 0)
      : 0;

  const toggleOptionalCharge = (chargeId: string) => {
    setSelectedOptionalChargeIds((prev) =>
      prev.includes(chargeId)
        ? prev.filter((id) => id !== chargeId)
        : [...prev, chargeId]
    );
  };

  const summaryItemGrid = isMobile
    ? "56px minmax(0, 1fr)"
    : "56px minmax(0, 1fr) auto";

  const cartLayoutColumns =
    isMobile || isTablet
      ? "1fr"
      : "minmax(0, 1.5fr) minmax(340px, 0.85fr)";

  const optionalChargePicker =
    optionalSelectableCharges.length > 0 ? (
      <div
        style={{
          borderRadius: `${innerRadius}px`,
          background: palette.cardBg,
          border: `1px solid ${palette.cardBorder}`,
          boxShadow: palette.cardShadow,
          padding: isMobile ? "16px" : "18px",
        }}
      >
        <h4
          style={{
            margin: "0 0 12px",
            fontSize: "15px",
            fontWeight: 700,
            color: palette.text,
          }}
        >
          Add-ons
        </h4>

        <div style={{ display: "grid", gap: "10px" }}>
          {optionalSelectableCharges.map((charge) => {
            const checked = selectedOptionalChargeIds.includes(charge.id);
            const previewAmount = calculateChargeAmount(
              charge,
              subtotalAfterDiscount
            );

            const hasValidDescription =
              charge.description &&
              !charge.description.toLowerCase().includes("optional checkout") &&
              !charge.description.toLowerCase().includes("selected by customer");

            return (
              <label
                key={charge.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: `1px solid ${palette.cardBorder}`,
                  background: checked ? palette.softBg : palette.inputBg,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    alignItems: "flex-start",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOptionalCharge(charge.id)}
                    style={{ marginTop: "3px" }}
                  />
                  <div>
                    <div
                      style={{
                        color: palette.text,
                        fontSize: "14px",
                        fontWeight: 700,
                        lineHeight: 1.3,
                      }}
                    >
                      {charge.label}
                    </div>
                    {hasValidDescription ? (
                      <div
                        style={{
                          marginTop: "4px",
                          color: palette.textMuted,
                          fontSize: "12px",
                          lineHeight: 1.45,
                        }}
                      >
                        {charge.description}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div
                  style={{
                    color: palette.text,
                    fontSize: "14px",
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  ₹{previewAmount}
                </div>
              </label>
            );
          })}
        </div>
      </div>
    ) : null;

  const summaryCard = (
    <div
      style={{
        borderRadius: `${innerRadius}px`,
        background: palette.cardBg,
        border: `1px solid ${palette.cardBorder}`,
        boxShadow: palette.cardShadow,
        padding: isMobile ? "16px" : "18px",
      }}
    >
      <h4
        style={{
          margin: "0 0 14px",
          fontSize: "18px",
          fontWeight: 700,
          color: palette.text,
          letterSpacing: "-0.02em",
        }}
      >
        {summaryTitle}
      </h4>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {show_promo !== false && (
          <div style={{ marginBottom: "6px" }}>
            <PromoCodeInput
              siteId={siteId || slug || ""}
              subtotal={subtotal}
              cartItems={cartItems}
              deliveryFee={shippingCharge}
              appliedCoupon={appliedCoupon}
              onCouponApplied={handleCouponApplied}
              onCouponRemoved={handleCouponRemoved}
              accentColor={resolvedAccentColor}
              textColor={palette.text}
              cardBg={palette.cardBg}
              inputBg={palette.inputBg}
              borderColor={palette.cardBorder}
            />
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            color: palette.textMuted,
            fontSize: "14px",
          }}
        >
          <span>{subtotalLabel}</span>
          <span style={{ color: palette.text }}>₹{subtotal}</span>
        </div>

        {promoDiscount > 0 ? (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              color: palette.successText,
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            <span>Promo Discount ({appliedCoupon?.code})</span>
            <span>-₹{promoDiscount.toFixed(2)}</span>
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            color: palette.textMuted,
            fontSize: "14px",
            alignItems: "center",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            {shippingRule?.label || shippingLabel}
            {shippingRule && (
              <ChargeInfoTooltip
                text={
                  freeShippingThreshold > 0
                    ? `Free delivery on orders above ₹${freeShippingThreshold}`
                    : "Standard delivery fee"
                }
                palette={palette}
              />
            )}
          </span>
          <span style={{ color: shippingWaived ? palette.successText : palette.text, fontWeight: shippingWaived ? 700 : 500 }}>
            {shippingWaived ? "Free" : shippingCharge > 0 ? `₹${shippingCharge}` : "₹0"}
          </span>
        </div>

        {nonShippingCharges.map((charge) => {
          const tooltipParts: string[] = [];
          if (charge.refundable === false) tooltipParts.push("Non-refundable");
          if (charge.waiveConditionType === "subtotal_gte" && charge.waiveConditionValue) {
            tooltipParts.push(`Waived above ₹${charge.waiveConditionValue}`);
          }
          if (
            charge.description &&
            !charge.description.toLowerCase().includes("optional checkout") &&
            !charge.description.toLowerCase().includes("selected by customer")
          ) {
            tooltipParts.push(charge.description);
          }
          const tooltipText = tooltipParts.join(". ");

          return (
            <div
              key={charge.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "12px",
                color: palette.textMuted,
                fontSize: "14px",
                alignItems: "center",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center" }}>
                {charge.label}
                {tooltipText ? <ChargeInfoTooltip text={tooltipText} palette={palette} /> : null}
              </span>
              <span style={{ color: palette.text }}>₹{charge.calculatedAmount}</span>
            </div>
          );
        })}

        {taxSettings?.enabled ? (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              color: palette.textMuted,
              fontSize: "14px",
              alignItems: "center",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center" }}>
              {taxSettings.label || fallbackTaxLabel}
              <ChargeInfoTooltip
                text={taxSettings.rate ? `Applied at ${taxSettings.rate}%` : "Calculated at checkout"}
                palette={palette}
              />
            </span>
            <span style={{ color: palette.text }}>₹{tax}</span>
          </div>
        ) : null}

        <div
          style={{
            height: "1px",
            background: palette.cardBorder,
            margin: "2px 0",
          }}
        />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: palette.text,
            }}
          >
            {totalLabel}
          </span>
          <span
            style={{
              fontSize: isMobile ? "20px" : "22px",
              fontWeight: 800,
              color: palette.text,
              letterSpacing: "-0.03em",
            }}
          >
            ₹{total}
          </span>
        </div>
      </div>

      {(footerNote || settingsLoading) && (
        <p
          style={{
            margin: "14px 0 16px",
            fontSize: "13px",
            color: palette.textMuted,
            lineHeight: 1.5,
          }}
        >
          {settingsLoading ? "Updating charges..." : footerNote}
        </p>
      )}

      {cartItems.length > 0 ? (
        <Link
          to={checkoutPath}
          style={{
            display: isCheckoutSummary ? "none" : "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            minHeight: "48px",
            borderRadius: "14px",
            background: resolvedAccentColor,
            color: isColorDarkHex(resolvedAccentColor) ? "#ffffff" : "#0f172a",
            fontSize: "14px",
            fontWeight: 700,
            textDecoration: "none",
            boxShadow: "0 14px 28px rgba(0,0,0,0.22)",
          }}
        >
          {checkoutLabel}
        </Link>
      ) : (
        <button
          type="button"
          disabled
          style={{
            display: isCheckoutSummary ? "none" : "block",
            width: "100%",
            minHeight: "48px",
            border: "none",
            borderRadius: "14px",
            background: palette.disabledBg,
            color: isColorDarkHex(palette.disabledBg) ? "#ffffff" : "#0f172a",
            fontSize: "14px",
            fontWeight: 700,
            cursor: "not-allowed",
          }}
        >
          {checkoutLabel}
        </button>
      )}
    </div>
  );

  if (isCheckoutSummary) {
    return (
      <section style={{ width: "100%" }}>
        <div
          style={{
            border: `1px solid ${palette.shellBorder}`,
            background: palette.shellBg,
            borderRadius: `${outerRadius}px`,
            overflow: "hidden",
            boxShadow: palette.shadow,
          }}
        >
          <div
            style={{
              padding: "20px",
              borderBottom: `1px solid ${palette.shellBorder}`,
              background: palette.headerBg,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "22px",
                lineHeight: 1.1,
                letterSpacing: "-0.03em",
                color: palette.text,
              }}
            >
              {heading}
            </h3>

            <p
              style={{
                margin: "8px 0 0",
                color: palette.textMuted,
                fontSize: "14px",
                lineHeight: 1.6,
              }}
            >
              {totalItems} item{totalItems !== 1 ? "s" : ""} in your order
            </p>
          </div>

          <div
            style={{
              padding: "18px",
              display: "grid",
              gap: "14px",
              background: palette.panelBg,
            }}
          >
            {cartItems.length === 0 ? (
              <div
                style={{
                  padding: "24px 16px",
                  borderRadius: `${innerRadius}px`,
                  border: `1px solid ${palette.cardBorder}`,
                  background: palette.cardBg,
                  textAlign: "center",
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: "16px",
                    fontWeight: 700,
                    color: palette.text,
                  }}
                >
                  {emptyHeading}
                </p>
                <p
                  style={{
                    margin: "8px 0 0",
                    fontSize: "14px",
                    color: palette.textMuted,
                    lineHeight: 1.6,
                  }}
                >
                  {emptyText}
                </p>
              </div>
            ) : (
              <>
                <FreeShippingProgress
                  subtotal={subtotalAfterDiscount}
                  threshold={freeShippingThreshold}
                  remaining={remainingForFreeShipping}
                  shippingWaived={shippingWaived}
                  accentColor={resolvedAccentColor}
                  palette={palette}
                />
                {shouldShowItems ? (
                  <div style={{ display: "grid", gap: "12px" }}>
                    {cartItems.map((item, index) => (
                      <div
                        key={`${item.id}-${item.selectedVariantValue || "default"}-${index}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: summaryItemGrid,
                          gap: "12px",
                          alignItems: "center",
                          padding: "12px",
                          borderRadius: `${innerRadius}px`,
                          background: palette.cardBg,
                          border: `1px solid ${palette.cardBorder}`,
                          boxShadow: palette.cardShadow,
                        }}
                      >
                        <div
                          style={{
                            width: "56px",
                            height: "56px",
                            borderRadius: "12px",
                            overflow: "hidden",
                            background: palette.mutedBg,
                          }}
                        >
                          <img
                            src={getThumbnailUrl(item.image, 140, 140)}
                            alt={item.name}
                            loading="eager"
                            decoding="async"
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              display: "block",
                            }}
                          />
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <p
                            style={{
                              margin: "0 0 4px",
                              fontSize: "14px",
                              fontWeight: 700,
                              color: palette.text,
                              lineHeight: 1.3,
                            }}
                          >
                            {item.name}
                          </p>

                          {item.selectedVariantValue ? (
                            <p
                              style={{
                                margin: "0 0 4px",
                                fontSize: "12px",
                                color: palette.textMuted,
                                lineHeight: 1.4,
                                wordBreak: "break-word",
                              }}
                            >
                              {item.selectedVariantLabel || "Option"}:{" "}
                              {item.selectedVariantValue}
                            </p>
                          ) : null}

                          <p
                            style={{
                              margin: 0,
                              fontSize: "13px",
                              color: palette.textMuted,
                            }}
                          >
                            Qty {item.quantity}
                          </p>
                        </div>

                        <p
                          style={{
                            margin: isMobile ? "2px 0 0 68px" : 0,
                            fontSize: "14px",
                            fontWeight: 700,
                            color: palette.text,
                            whiteSpace: "nowrap",
                            textAlign: isMobile ? "left" : "right",
                          }}
                        >
                          ₹{item.price * item.quantity}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}

                {shouldShowGiftCard ? optionalChargePicker : null}

                {show_summary ? summaryCard : null}
              </>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      style={{
        padding: embeddedInEditorWrapper
          ? 0
          : isMobile
          ? "16px 0 28px"
          : "24px 0 36px",
        width: "100%",
        maxWidth: resolvedMaxWidth,
        minHeight: resolvedMinHeight ? `${resolvedMinHeight}px` : undefined,
        margin: "0 auto",
        background: "transparent",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          border: `1px solid ${palette.shellBorder}`,
          background: palette.shellBg,
          borderRadius: `${outerRadius}px`,
          overflow: "hidden",
          boxShadow: palette.shadow,
          minHeight: `${resolvedMinHeight}px`,
          width: "100%",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: isMobile ? "16px 14px" : "20px 24px 18px",
            borderBottom: `1px solid ${palette.shellBorder}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: isMobile ? "center" : "flex-start",
            gap: "12px",
            flexWrap: isMobile ? "nowrap" : "wrap",
            background: palette.headerBg,
          }}
        >
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: isMobile ? "20px" : "clamp(22px, 2vw, 30px)",
                lineHeight: 1.05,
                letterSpacing: "-0.03em",
                color: palette.text,
              }}
            >
              {heading}
            </h3>

            <p
              style={{
                margin: isMobile ? "4px 0 0" : "8px 0 0",
                color: palette.textMuted,
                fontSize: isMobile ? "12px" : "14px",
              }}
            >
              {totalItems} item{totalItems !== 1 ? "s" : ""} in your cart
            </p>
          </div>

          {cartItems.length > 0 ? (
            <button
              onClick={clearCart}
              style={{
                border: `1px solid ${palette.shellBorder}`,
                background: palette.softBg,
                color: palette.text,
                borderRadius: isMobile ? "10px" : "12px",
                cursor: "pointer",
                padding: isMobile ? "6px 12px" : "10px 14px",
                fontSize: isMobile ? "12px" : "13px",
                fontWeight: 600,
                width: "auto",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {clearText}
            </button>
          ) : null}
        </div>

        <div
          style={{
            padding: isMobile ? "16px 14px" : "22px 24px 28px",
            background: palette.panelBg,
            flex: 1,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {cartItems.length === 0 ? (
            <div
              style={{
                padding: isMobile ? "32px 16px" : "48px 24px",
                minHeight: `${Math.max(180, resolvedMinHeight - 140)}px`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                borderRadius: `${innerRadius}px`,
                border: `1px solid ${palette.cardBorder}`,
                background: palette.cardBg,
                boxShadow: "none",
                flex: 1,
              }}
            >
              <div style={{ marginBottom: "14px", display: "flex", justifyContent: "center", color: palette.textMuted }}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ width: "44px", height: "44px" }}
                >
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
                  <path d="M3 6h18" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "19px",
                  fontWeight: 700,
                  color: palette.text,
                }}
              >
                {emptyHeading}
              </p>
              <p
                style={{
                  margin: "8px auto 0",
                  fontSize: "14px",
                  color: palette.textMuted,
                  maxWidth: "420px",
                  lineHeight: 1.6,
                }}
              >
                {emptyText}
              </p>
              <Link
                to={explorePath}
                style={{
                  marginTop: "20px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "9px 22px",
                  borderRadius: "10px",
                  background: resolvedAccentColor,
                  color: "#ffffff",
                  fontSize: "13px",
                  fontWeight: 700,
                  textDecoration: "none",
                  cursor: "pointer",
                  boxShadow: `0 2px 8px ${alpha(resolvedAccentColor, 0.3)}`,
                  transition: "opacity 0.15s ease",
                }}
              >
                Explore Products
              </Link>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: cartLayoutColumns,
                gap: "18px",
                alignItems: "start",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                }}
              >
                <FreeShippingProgress
                  subtotal={subtotalAfterDiscount}
                  threshold={freeShippingThreshold}
                  remaining={remainingForFreeShipping}
                  shippingWaived={shippingWaived}
                  accentColor={resolvedAccentColor}
                  palette={palette}
                />
                {cartItems.map((item, index) => (
                  <div
                    key={`${item.id}-${item.selectedVariantValue || "default"}-${index}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile
                        ? "72px minmax(0, 1fr)"
                        : "92px minmax(0, 1fr)",
                      gap: isMobile ? "12px" : "14px",
                      alignItems: "start",
                      padding: isMobile ? "12px" : "14px",
                      borderRadius: `${innerRadius}px`,
                      background: palette.cardBg,
                      border: `1px solid ${palette.cardBorder}`,
                      boxShadow: palette.cardShadow,
                    }}
                  >
                    <div
                      style={{
                        width: isMobile ? "72px" : "92px",
                        height: isMobile ? "72px" : "92px",
                        borderRadius: isMobile ? "14px" : "16px",
                        overflow: "hidden",
                        background: palette.mutedBg,
                        flexShrink: 0,
                      }}
                    >
                      <img
                        src={getThumbnailUrl(item.image, 180, 180)}
                        alt={item.name}
                        loading="eager"
                        decoding="async"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: "12px",
                          marginBottom: "8px",
                          flexWrap: isMobile ? "wrap" : "nowrap",
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p
                            style={{
                              margin: "0 0 6px",
                              fontSize: isMobile ? "15px" : "16px",
                              fontWeight: 700,
                              color: palette.text,
                              lineHeight: 1.35,
                            }}
                          >
                            {item.name}
                          </p>

                          {item.selectedVariantValue ? (
                            <p
                              style={{
                                margin: "0 0 6px",
                                fontSize: "13px",
                                color: palette.textMuted,
                                lineHeight: 1.5,
                              }}
                            >
                              {item.selectedVariantLabel || "Option"}:{" "}
                              {item.selectedVariantValue}
                            </p>
                          ) : null}

                          <p
                            style={{
                              margin: 0,
                              fontSize: "13px",
                              color: palette.textMuted,
                            }}
                          >
                            ₹{item.price} each
                          </p>
                        </div>

                        <div
                          style={{
                            fontSize: isMobile ? "16px" : "18px",
                            fontWeight: 800,
                            color: palette.text,
                            whiteSpace: "nowrap",
                          }}
                        >
                          ₹{item.price * item.quantity}
                        </div>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "10px",
                          marginTop: isMobile ? "6px" : "0",
                        }}
                      >
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            borderRadius: "999px",
                            border: `1px solid ${palette.cardBorder}`,
                            background: palette.quantityBg,
                            overflow: "hidden",
                            minHeight: isMobile ? "34px" : "42px",
                            height: isMobile ? "34px" : "42px",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              updateQuantity(
                                item.id,
                                item.quantity - 1,
                                item.selectedVariantValue ?? null
                              )
                            }
                            style={{
                              width: isMobile ? "32px" : "40px",
                              height: isMobile ? "34px" : "42px",
                              border: "none",
                              background: "transparent",
                              color: palette.text,
                              fontSize: isMobile ? "16px" : "18px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: 0,
                            }}
                          >
                            -
                          </button>

                          <div
                            style={{
                              minWidth: isMobile ? "32px" : "42px",
                              textAlign: "center",
                              fontSize: isMobile ? "13px" : "14px",
                              fontWeight: 700,
                              color: palette.text,
                            }}
                          >
                            {item.quantity}
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              updateQuantity(
                                item.id,
                                item.quantity + 1,
                                item.selectedVariantValue ?? null
                              )
                            }
                            style={{
                              width: isMobile ? "32px" : "40px",
                              height: isMobile ? "34px" : "42px",
                              border: "none",
                              background: "transparent",
                              color: palette.text,
                              fontSize: isMobile ? "16px" : "18px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: 0,
                            }}
                          >
                            +
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            removeFromCart(
                              item.id,
                              item.selectedVariantValue ?? null
                            )
                          }
                          style={{
                            border: "none",
                            background: isMobile ? palette.softBg : "transparent",
                            color: palette.danger,
                            cursor: "pointer",
                            fontSize: isMobile ? "12px" : "13px",
                            fontWeight: 600,
                            padding: isMobile ? "6px 10px" : 0,
                            borderRadius: isMobile ? "8px" : 0,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          {removeText}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  minWidth: 0,
                  display: "grid",
                  gap: "14px",
                  position: isMobile || isTablet ? "static" : "sticky",
                  top: isMobile || isTablet ? undefined : "24px",
                }}
              >
                {optionalChargePicker}

                {show_summary ? summaryCard : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default CartSidebar;