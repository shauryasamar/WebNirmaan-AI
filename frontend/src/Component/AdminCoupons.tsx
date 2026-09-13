import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { API_BASE_URL as API_BASE } from "../config/api";
import GlassToast from "./GlassToast";
import { useAdminAuth } from "../context/AdminAuthContext";
import AccessDeniedView from "./AccessDeniedView";

interface CouponItem {
  id: string;
  siteId: string;
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
  totalUsageLimit?: number | null;
  timesUsed: number;
  perCustomerLimit: number;
  startsAt?: string | null;
  expiresAt?: string | null;
  isActive: boolean;
  isPublic?: boolean;
  totalSavings: number;
  createdAt: string;
}

interface CouponStats {
  totalCoupons: number;
  activeCoupons: number;
  totalRedemptions: number;
  totalSavings: number;
}

// -------------------------------------------------------------
// HIGH-PERFORMANCE IN-MEMORY & LOCAL/SESSION STORAGE CACHING
// -------------------------------------------------------------
interface AdminCouponsCacheEntry {
  coupons: CouponItem[];
  stats: CouponStats;
  timestamp: number;
}

const adminCouponsMemoryCache = new Map<string, AdminCouponsCacheEntry>();

function getStoredCouponsCache(siteId: string): AdminCouponsCacheEntry | null {
  if (!siteId) return null;
  const mem = adminCouponsMemoryCache.get(siteId);
  if (mem) return mem;

  try {
    const raw = sessionStorage.getItem(`webcreon_admin_coupons_cache:${siteId}`) || localStorage.getItem(`webcreon_admin_coupons_cache:${siteId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.coupons)) {
        adminCouponsMemoryCache.set(siteId, parsed);
        return parsed;
      }
    }
  } catch {}
  return null;
}

function setStoredCouponsCache(siteId: string, coupons: CouponItem[], stats: CouponStats) {
  if (!siteId) return;
  const entry: AdminCouponsCacheEntry = {
    coupons,
    stats,
    timestamp: Date.now(),
  };
  adminCouponsMemoryCache.set(siteId, entry);
  try {
    const serialized = JSON.stringify(entry);
    sessionStorage.setItem(`webcreon_admin_coupons_cache:${siteId}`, serialized);
    localStorage.setItem(`webcreon_admin_coupons_cache:${siteId}`, serialized);
  } catch {}
}

// Icons
const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const FilterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const XMarkIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const EditIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const DiceIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 8h.01M8 8h.01M8 16h.01M16 16h.01M12 12h.01" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const PauseCircleIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="10" y1="15" x2="10" y2="9" />
    <line x1="14" y1="15" x2="14" y2="9" />
  </svg>
);

const TagIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

// Form Error Display
const ErrorBadge = ({ message }: { message?: string }) => {
  if (!message) return null;
  return <div style={{ fontSize: "11px", fontWeight: 600, color: "#dc2626", marginTop: "4px" }}>{message}</div>;
};

export default function AdminCoupons({ siteId: propSiteId }: { siteId?: string }) {
  const { hasPermission } = useAdminAuth();
  const canViewDiscounts = hasPermission("discounts:view");
  const canCreateDiscounts = hasPermission("discounts:create");
  const canEditDiscounts = hasPermission("discounts:edit");
  const canDeleteDiscounts = hasPermission("discounts:delete");

  const { siteId: paramSiteId } = useParams<{ siteId: string }>();
  const activeSiteId = propSiteId || paramSiteId || "";

  const cachedInitial = useMemo(() => getStoredCouponsCache(activeSiteId), [activeSiteId]);

  const [coupons, setCoupons] = useState<CouponItem[]>(() => cachedInitial?.coupons || []);
  const [stats, setStats] = useState<CouponStats>(() => cachedInitial?.stats || {
    totalCoupons: 0,
    activeCoupons: 0,
    totalRedemptions: 0,
    totalSavings: 0,
  });
  const [loading, setLoading] = useState(!cachedInitial);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused" | "expired">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Filter Popover
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const filterPopoverRef = useRef<HTMLDivElement>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterFirstOrder, setFilterFirstOrder] = useState<string>("all");
  const [filterSortBy, setFilterSortBy] = useState<string>("newest");

  // Toast
  const [toastMsg, setToastMsg] = useState("");
  const [toastType, setToastType] = useState<"success" | "error" | "info">("info");
  const showToast = (msg: string, type: "success" | "error" | "info" = "info") => {
    setToastMsg(msg);
    setToastType(type);
    setTimeout(() => setToastMsg(""), 3500);
  };

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<CouponItem | null>(null);
  const [saving, setSaving] = useState(false);

  // Form State
  const [formCode, setFormCode] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formType, setFormType] = useState<"percentage" | "fixed_amount" | "free_shipping">("percentage");
  const [formValue, setFormValue] = useState<string>("10");
  const [formMaxCap, setFormMaxCap] = useState<string>("");
  const [formAppliesTo, setFormAppliesTo] = useState<"all" | "collections" | "categories">("all");
  const [formCollectionIds, setFormCollectionIds] = useState<string[]>([]);
  const [formCategoryIds, setFormCategoryIds] = useState<string[]>([]);
  const [formMinOrder, setFormMinOrder] = useState<string>("0");
  const [formFirstOrderOnly, setFormFirstOrderOnly] = useState(false);
  const [formTotalLimit, setFormTotalLimit] = useState<string>("");
  const [formPerCustomerLimit, setFormPerCustomerLimit] = useState<string>("1");
  const [formStartsAt, setFormStartsAt] = useState<string>("");
  const [formExpiresAt, setFormExpiresAt] = useState<string>("");
  const [formIsActive, setFormIsActive] = useState(true);
  const [formIsPublic, setFormIsPublic] = useState(true);

  // Store Collections and Categories metadata
  const [storeCollections, setStoreCollections] = useState<Array<{ id: string; name: string }>>([]);
  const [storeCategories, setStoreCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [collectionsSearch, setCollectionsSearch] = useState("");
  const [categoriesSearch, setCategoriesSearch] = useState("");

  const collectionNameMap = useMemo(() => {
    const map = new Map<string, string>();
    storeCollections.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [storeCollections]);

  const categoryNameMap = useMemo(() => {
    const map = new Map<string, string>();
    storeCategories.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [storeCategories]);

  // Validation Errors
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});

  // Close filter popover on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterPopoverRef.current && !filterPopoverRef.current.contains(e.target as Node)) {
        setShowFilterPopover(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchCoupons = async (isSilentBackground = false) => {
    if (!activeSiteId) return;
    if (!isSilentBackground && coupons.length === 0) {
      setLoading(true);
    }
    try {
      const res = await fetch(`${API_BASE}/coupons/admin/${activeSiteId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to load discount coupons");
      }
      const data = await res.json();
      const freshCoupons = data.coupons || [];
      const freshStats = data.stats || {
        totalCoupons: freshCoupons.length,
        activeCoupons: freshCoupons.filter((c: any) => c.isActive).length,
        totalRedemptions: 0,
        totalSavings: 0,
      };
      setCoupons(freshCoupons);
      setStats(freshStats);
      setStoredCouponsCache(activeSiteId, freshCoupons, freshStats);
    } catch (err: any) {
      if (coupons.length === 0) {
        showToast(err.message || "Failed to load promo codes", "error");
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchStoreScopeData = async () => {
    if (!activeSiteId) return;
    try {
      const [colRes, catRes] = await Promise.all([
        fetch(`${API_BASE}/sites/${activeSiteId}/collections`, { credentials: "include" }),
        fetch(`${API_BASE}/sites/${activeSiteId}/categories`, { credentials: "include" }),
      ]);
      if (colRes.ok) {
        const colData = await colRes.json();
        if (Array.isArray(colData)) {
          setStoreCollections(colData.map((c: any) => ({ id: String(c.id), name: c.name })));
        }
      }
      if (catRes.ok) {
        const catData = await catRes.json();
        if (Array.isArray(catData)) {
          setStoreCategories(catData.map((c: any) => ({ id: String(c.id), name: c.name })));
        }
      }
    } catch (err) {
      console.warn("Failed to load collections/categories for coupon scope", err);
    }
  };

  useEffect(() => {
    fetchCoupons(Boolean(cachedInitial));
    fetchStoreScopeData();
  }, [activeSiteId]);

  const generateRandomCode = () => {
    const prefixes = ["SAVE", "DEAL", "OFF", "SUPER", "VIP", "FLASH", "FESTIVE"];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const num = Math.floor(10 + Math.random() * 90);
    setFormCode(`${prefix}${num}`);
    if (formErrors.code) setFormErrors((prev) => ({ ...prev, code: "" }));
  };

  const handleOpenCreateModal = () => {
    if (!canCreateDiscounts) {
      showToast("You do not have permission to create promo codes", "error");
      return;
    }
    setEditingCoupon(null);
    setFormCode("");
    setFormDescription("");
    setFormType("percentage");
    setFormValue("10");
    setFormMaxCap("");
    setFormAppliesTo("all");
    setFormCollectionIds([]);
    setFormCategoryIds([]);
    setCollectionsSearch("");
    setCategoriesSearch("");
    setFormMinOrder("0");
    setFormFirstOrderOnly(false);
    setFormTotalLimit("");
    setFormPerCustomerLimit("1");
    setFormStartsAt("");
    setFormExpiresAt("");
    setFormIsActive(true);
    setFormIsPublic(true);
    setFormErrors({});
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (coupon: CouponItem) => {
    if (!canEditDiscounts) {
      showToast("You do not have permission to edit promo codes", "error");
      return;
    }
    setEditingCoupon(coupon);
    setFormCode(coupon.code);
    setFormDescription(coupon.description || "");
    setFormType(coupon.discountType);
    setFormValue(String(coupon.discountValue));
    setFormMaxCap(coupon.maxDiscountAmount ? String(coupon.maxDiscountAmount) : "");
    setFormAppliesTo(coupon.appliesTo || "all");
    setFormCollectionIds(coupon.collectionIds || []);
    setFormCategoryIds(coupon.categoryIds || []);
    setCollectionsSearch("");
    setCategoriesSearch("");
    setFormMinOrder(String(coupon.minOrderValue || "0"));
    setFormFirstOrderOnly(coupon.isFirstOrderOnly);
    setFormTotalLimit(coupon.totalUsageLimit ? String(coupon.totalUsageLimit) : "");
    setFormPerCustomerLimit(String(coupon.perCustomerLimit || "1"));
    setFormStartsAt(coupon.startsAt ? coupon.startsAt.slice(0, 16) : "");
    setFormExpiresAt(coupon.expiresAt ? coupon.expiresAt.slice(0, 16) : "");
    setFormIsActive(coupon.isActive);
    setFormIsPublic(coupon.isPublic !== false);
    setFormErrors({});
    setIsModalOpen(true);
  };

  // Client-side Validation
  const validateForm = (): boolean => {
    const errors: { [key: string]: string } = {};

    const code = formCode.trim().toUpperCase();
    if (!code) {
      errors.code = "Promo code is required.";
    } else if (!/^[A-Z0-9_-]{3,25}$/.test(code)) {
      errors.code = "Code must be 3-25 characters (letters, numbers, hyphens only).";
    }

    if (formType !== "free_shipping") {
      const val = parseFloat(formValue);
      if (isNaN(val) || val <= 0) {
        errors.value = "Enter a valid discount value greater than 0.";
      } else if (formType === "percentage" && val > 100) {
        errors.value = "Percentage discount cannot exceed 100%.";
      }

      if (formType === "percentage" && formMaxCap) {
        const cap = parseFloat(formMaxCap);
        if (isNaN(cap) || cap <= 0) {
          errors.maxCap = "Max savings cap must be greater than 0.";
        }
      }
    }

    if (formAppliesTo === "collections" && formCollectionIds.length === 0) {
      errors.targeting = "Please select at least one collection.";
    }

    if (formAppliesTo === "categories" && formCategoryIds.length === 0) {
      errors.targeting = "Please select at least one category.";
    }

    if (formMinOrder) {
      const minO = parseFloat(formMinOrder);
      if (isNaN(minO) || minO < 0) {
        errors.minOrder = "Minimum order cannot be negative.";
      }
    }

    if (formTotalLimit) {
      const totL = parseInt(formTotalLimit);
      if (isNaN(totL) || totL < 1) {
        errors.totalLimit = "Store usage limit must be at least 1.";
      }
    }

    if (formPerCustomerLimit) {
      const custL = parseInt(formPerCustomerLimit);
      if (isNaN(custL) || custL < 1) {
        errors.perCustomer = "Per-customer limit must be at least 1.";
      }
    }

    if (formStartsAt && formExpiresAt) {
      if (new Date(formExpiresAt).getTime() <= new Date(formStartsAt).getTime()) {
        errors.expiresAt = "Expiry date must be after start date.";
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingCoupon && !canEditDiscounts) {
      showToast("You do not have permission to edit promo codes", "error");
      return;
    }
    if (!editingCoupon && !canCreateDiscounts) {
      showToast("You do not have permission to create promo codes", "error");
      return;
    }
    if (!validateForm()) return;

    setSaving(true);
    try {
      const payload = {
        code: formCode.trim().toUpperCase(),
        description: formDescription.trim() || undefined,
        discount_type: formType,
        discount_value: formType === "free_shipping" ? 0 : parseFloat(formValue) || 0,
        max_discount_amount: formType === "percentage" && formMaxCap ? parseFloat(formMaxCap) : null,
        applies_to: formAppliesTo,
        collection_ids: formAppliesTo === "collections" ? formCollectionIds : [],
        category_ids: formAppliesTo === "categories" ? formCategoryIds : [],
        min_order_value: parseFloat(formMinOrder) || 0,
        is_first_order_only: formFirstOrderOnly,
        total_usage_limit: formTotalLimit ? parseInt(formTotalLimit) : null,
        per_customer_limit: parseInt(formPerCustomerLimit) || 1,
        starts_at: formStartsAt ? new Date(formStartsAt).toISOString() : null,
        expires_at: formExpiresAt ? new Date(formExpiresAt).toISOString() : null,
        is_active: formIsActive,
        is_public: formIsPublic,
      };

      const url = editingCoupon
        ? `${API_BASE}/coupons/admin/${activeSiteId}/${editingCoupon.id}`
        : `${API_BASE}/coupons/admin/${activeSiteId}`;
      const method = editingCoupon ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || "Failed to save promo code");
      }

      showToast(editingCoupon ? "Promo code updated successfully!" : "Promo code created successfully!", "success");
      setIsModalOpen(false);
      fetchCoupons();
    } catch (err: any) {
      showToast(err.message || "An error occurred", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (coupon: CouponItem) => {
    if (!canEditDiscounts) {
      showToast("You do not have permission to update promo codes", "error");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/coupons/admin/${activeSiteId}/${coupon.id}/toggle`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update status");
      const data = await res.json();
      showToast(data.message || "Status updated", "success");
      const updatedCoupons = coupons.map((c) => (c.id === coupon.id ? { ...c, isActive: !c.isActive } : c));
      const updatedStats = {
        ...stats,
        activeCoupons: coupon.isActive ? stats.activeCoupons - 1 : stats.activeCoupons + 1,
      };
      setCoupons(updatedCoupons);
      setStats(updatedStats);
      setStoredCouponsCache(activeSiteId, updatedCoupons, updatedStats);
    } catch (err: any) {
      showToast(err.message || "Failed to toggle status", "error");
    }
  };

  const handleDeleteCoupon = async (coupon: CouponItem) => {
    if (!canDeleteDiscounts) {
      showToast("You do not have permission to delete promo codes", "error");
      return;
    }
    if (!window.confirm(`Are you sure you want to delete promo code '${coupon.code}'?`)) return;
    try {
      const res = await fetch(`${API_BASE}/coupons/admin/${activeSiteId}/${coupon.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete coupon");
      showToast(`Promo code '${coupon.code}' deleted`, "success");
      const updatedCoupons = coupons.filter((c) => c.id !== coupon.id);
      const updatedStats = {
        ...stats,
        totalCoupons: stats.totalCoupons - 1,
        activeCoupons: coupon.isActive ? stats.activeCoupons - 1 : stats.activeCoupons,
      };
      setCoupons(updatedCoupons);
      setStats(updatedStats);
      setStoredCouponsCache(activeSiteId, updatedCoupons, updatedStats);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(coupon.id);
        return next;
      });
    } catch (err: any) {
      showToast(err.message || "Failed to delete coupon", "error");
    }
  };

  // Bulk Actions
  const handleBulkSetStatus = async (makeActive: boolean) => {
    if (!canEditDiscounts) {
      showToast("You do not have permission to update promo codes", "error");
      return;
    }
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const ids = Array.from(selectedIds);
      await Promise.all(
        ids.map((id) =>
          fetch(`${API_BASE}/coupons/admin/${activeSiteId}/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ is_active: makeActive }),
          })
        )
      );
      showToast(`${ids.length} promo codes ${makeActive ? "activated" : "paused"}`, "success");
      setSelectedIds(new Set());
      fetchCoupons();
    } catch (err: any) {
      showToast(err.message || "Failed to update status for selected promo codes", "error");
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!canDeleteDiscounts) {
      showToast("You do not have permission to delete promo codes", "error");
      return;
    }
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Are you sure you want to permanently delete ${selectedIds.size} promo codes?`)) return;
    setBulkLoading(true);
    try {
      const toDelete = Array.from(selectedIds);
      await Promise.all(
        toDelete.map((id) =>
          fetch(`${API_BASE}/coupons/admin/${activeSiteId}/${id}`, {
            method: "DELETE",
            credentials: "include",
          })
        )
      );
      showToast(`${selectedIds.size} promo codes deleted`, "success");
      setSelectedIds(new Set());
      fetchCoupons();
    } catch (err: any) {
      showToast(err.message || "Failed to delete selected promo codes", "error");
    } finally {
      setBulkLoading(false);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    showToast(`Copied '${code}' to clipboard!`, "success");
  };

  const isExpired = (coupon: CouponItem) => {
    if (!coupon.expiresAt) return false;
    return new Date(coupon.expiresAt).getTime() < Date.now();
  };

  const isExpiringSoon = (coupon: CouponItem) => {
    if (!coupon.expiresAt || isExpired(coupon)) return false;
    const diffDays = (new Date(coupon.expiresAt).getTime() - Date.now()) / (1000 * 3600 * 24);
    return diffDays >= 0 && diffDays <= 7;
  };

  // Compute counts for tabs and expiring soon
  const activeCount = useMemo(() => coupons.filter((c) => c.isActive && !isExpired(c)).length, [coupons]);
  const pausedCount = useMemo(() => coupons.filter((c) => !c.isActive && !isExpired(c)).length, [coupons]);
  const expiredCount = useMemo(() => coupons.filter((c) => isExpired(c)).length, [coupons]);
  const expiringSoonCount = useMemo(() => coupons.filter(isExpiringSoon).length, [coupons]);

  // Active filter count
  const activeFilterCount = (filterType !== "all" ? 1 : 0) + (filterFirstOrder !== "all" ? 1 : 0) + (filterSortBy !== "newest" ? 1 : 0);

  // Filtered & Sorted Coupons
  const filteredCoupons = useMemo(() => {
    return coupons
      .filter((c) => {
        if (statusFilter === "active" && (!c.isActive || isExpired(c))) return false;
        if (statusFilter === "paused" && (c.isActive || isExpired(c))) return false;
        if (statusFilter === "expired" && !isExpired(c)) return false;

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchCode = c.code.toLowerCase().includes(q);
          const matchDesc = (c.description || "").toLowerCase().includes(q);
          if (!matchCode && !matchDesc) return false;
        }

        if (filterType !== "all" && c.discountType !== filterType) return false;
        if (filterFirstOrder === "first_only" && !c.isFirstOrderOnly) return false;
        if (filterFirstOrder === "all_orders" && c.isFirstOrderOnly) return false;

        return true;
      })
      .sort((a, b) => {
        if (filterSortBy === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        if (filterSortBy === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (filterSortBy === "most_used") return b.timesUsed - a.timesUsed;
        if (filterSortBy === "discount_desc") return b.discountValue - a.discountValue;
        if (filterSortBy === "code_asc") return a.code.localeCompare(b.code);
        return 0;
      });
  }, [coupons, statusFilter, searchQuery, filterType, filterFirstOrder, filterSortBy]);

  // Styling Tokens
  const plainCardStyle: React.CSSProperties = {
    background: "#ffffff",
    borderRadius: "10px",
    border: "1px solid #cbd5e1",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
  };

  const thStyle: React.CSSProperties = {
    padding: "10px 14px",
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#64748b",
  };

  const tdStyle: React.CSSProperties = {
    padding: "12px 14px",
    verticalAlign: "middle",
    borderBottom: "1px solid #f1f5f9",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    height: "36px",
    borderRadius: "7px",
    border: "1px solid #cbd5e1",
    background: "#f8fafc",
    padding: "0 10px",
    fontSize: "13px",
    color: "#0f172a",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "12px",
    fontWeight: 700,
    color: "#334155",
    marginBottom: "4px",
    display: "block",
  };

  if (!canViewDiscounts) {
    return (
      <AccessDeniedView
        title="Discounts Access Restricted"
        message="You do not have permission to view or manage discount coupons. Please contact your workspace administrator to request access."
      />
    );
  }

  return (
    <div style={{ width: "100%", color: "#0f172a", display: "flex", flexDirection: "column", gap: "10px", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <style>{`
        @keyframes storeShimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
      {toastMsg && <GlassToast message={toastMsg} type={toastType} onClose={() => setToastMsg("")} />}

      {/* 1. TOP HEADER CARD (Mode Switcher + Search & Filter Button) */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "10px",
          padding: "10px 14px",
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          position: "relative",
        }}
      >
        {/* Row 1: Mode Switcher + Global Search + Filter Button */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          {/* Mode Pill (Discounts) */}
          <div
            style={{
              display: "inline-flex",
              background: "#f1f5f9",
              padding: "3px",
              borderRadius: "8px",
              border: "1px solid #e2e8f0",
            }}
          >
            <button
              type="button"
              style={{
                borderRadius: "6px",
                padding: "6px 16px",
                border: "none",
                background: "#ffffff",
                color: "#0f172a",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "default",
                textTransform: "capitalize",
                transition: "all 0.15s ease",
              }}
            >
              Discounts
            </button>
          </div>

          {/* Search Bar & Filter Button Container */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flex: "1 1 300px",
              maxWidth: "520px",
              position: "relative",
            }}
          >
            <div style={{ position: "relative", flex: 1 }}>
              <div
                style={{
                  position: "absolute",
                  left: "11px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#94a3b8",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <SearchIcon />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search discounts by code, description..."
                style={{
                  ...inputStyle,
                  paddingLeft: "34px",
                  paddingRight: searchQuery ? "28px" : "12px",
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#94a3b8",
                    padding: "2px",
                    display: "grid",
                    placeItems: "center",
                  }}
                  title="Clear search"
                >
                  <XMarkIcon />
                </button>
              )}
            </div>

            {/* Filter Toggle Button */}
            <div style={{ position: "relative" }} ref={filterPopoverRef}>
              <button
                type="button"
                onClick={() => setShowFilterPopover(!showFilterPopover)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  height: "36px",
                  padding: "0 12px",
                  borderRadius: "7px",
                  border: activeFilterCount > 0 ? "1px solid #93c5fd" : "1px solid #cbd5e1",
                  background: activeFilterCount > 0 ? "#eff6ff" : "#ffffff",
                  color: activeFilterCount > 0 ? "#1d4ed8" : "#334155",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
                title="Toggle Filters"
              >
                <FilterIcon />
                <span>Filters</span>
                {activeFilterCount > 0 && (
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      background: "#2563eb",
                      color: "#ffffff",
                      borderRadius: "10px",
                      padding: "0 6px",
                      marginLeft: "2px",
                    }}
                  >
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {/* Filter Popover Panel */}
              {showFilterPopover && (
                <div
                  style={{
                    position: "absolute",
                    top: "44px",
                    right: 0,
                    width: "290px",
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: "10px",
                    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)",
                    padding: "16px",
                    zIndex: 60,
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f1f5f9", paddingBottom: "8px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>Filter Discounts</span>
                    {activeFilterCount > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setFilterType("all");
                          setFilterFirstOrder("all");
                          setFilterSortBy("newest");
                          setShowFilterPopover(false);
                        }}
                        style={{ background: "none", border: "none", color: "#dc2626", fontSize: "11px", fontWeight: 600, cursor: "pointer", padding: 0 }}
                      >
                        Reset All
                      </button>
                    )}
                  </div>

                  {/* Filter by Type */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569" }}>Discount Type</label>
                    <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ ...inputStyle, fontSize: "12.5px", padding: "5px 8px" }}>
                      <option value="all">All Types</option>
                      <option value="percentage">Percentage (%)</option>
                      <option value="fixed_amount">Fixed Amount (₹)</option>
                      <option value="free_shipping">Free Shipping</option>
                    </select>
                  </div>

                  {/* Filter First Order */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569" }}>Customer Eligibility</label>
                    <select value={filterFirstOrder} onChange={(e) => setFilterFirstOrder(e.target.value)} style={{ ...inputStyle, fontSize: "12.5px", padding: "5px 8px" }}>
                      <option value="all">All Discounts</option>
                      <option value="first_only">First-Time Customers Only</option>
                      <option value="all_orders">Existing & Returning</option>
                    </select>
                  </div>

                  {/* Sort By */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 600, color: "#475569" }}>Sort Order</label>
                    <select value={filterSortBy} onChange={(e) => setFilterSortBy(e.target.value)} style={{ ...inputStyle, fontSize: "12.5px", padding: "5px 8px" }}>
                      <option value="newest">Newest Created</option>
                      <option value="oldest">Oldest Created</option>
                      <option value="most_used">Most Redeemed</option>
                      <option value="discount_desc">Highest Discount</option>
                      <option value="code_asc">Code: A to Z</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                    <button
                      type="button"
                      onClick={() => setShowFilterPopover(false)}
                      style={{
                        flex: 1,
                        height: "32px",
                        background: "#2563eb",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Apply Filters
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Active Filter Chips */}
        {activeFilterCount > 0 && (
          <div
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              flexWrap: "wrap",
              paddingTop: "6px",
              borderTop: "1px solid #f1f5f9",
            }}
          >
            <span style={{ fontSize: "11.5px", color: "#64748b", fontWeight: 600, marginRight: "2px" }}>
              Active:
            </span>

            {filterType !== "all" && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  border: "1px solid #bfdbfe",
                }}
              >
                <span>Type: {filterType.replace("_", " ")}</span>
                <button
                  type="button"
                  onClick={() => setFilterType("all")}
                  style={{ background: "none", border: "none", color: "#1d4ed8", cursor: "pointer", padding: 0 }}
                >
                  <XMarkIcon />
                </button>
              </span>
            )}

            {filterFirstOrder !== "all" && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  border: "1px solid #bfdbfe",
                }}
              >
                <span>{filterFirstOrder === "first_only" ? "1st Order Only" : "Existing Users"}</span>
                <button
                  type="button"
                  onClick={() => setFilterFirstOrder("all")}
                  style={{ background: "none", border: "none", color: "#1d4ed8", cursor: "pointer", padding: 0 }}
                >
                  <XMarkIcon />
                </button>
              </span>
            )}

            {filterSortBy !== "newest" && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontSize: "11.5px",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  border: "1px solid #bfdbfe",
                }}
              >
                <span>Sort: {filterSortBy}</span>
                <button
                  type="button"
                  onClick={() => setFilterSortBy("newest")}
                  style={{ background: "none", border: "none", color: "#1d4ed8", cursor: "pointer", padding: 0 }}
                >
                  <XMarkIcon />
                </button>
              </span>
            )}

            <button
              type="button"
              onClick={() => {
                setFilterType("all");
                setFilterFirstOrder("all");
                setFilterSortBy("newest");
              }}
              style={{
                background: "none",
                border: "none",
                color: "#dc2626",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
                marginLeft: "2px",
                padding: "2px 4px",
              }}
            >
              Clear All
            </button>
          </div>
        )}
      </div>

      {/* 2. 5 SUMMARY KPI STAT BOXES */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
          gap: "12px",
          width: "100%",
        }}
      >
        {/* Total Campaigns */}
        <div style={{ ...plainCardStyle, padding: "12px 14px", minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ fontSize: "22px", fontWeight: 600, color: "#334155", lineHeight: 1, fontFamily: "'Inter', sans-serif" }}>
            {stats.totalCoupons}
          </div>
          <div style={{ fontSize: "12px", fontWeight: 500, color: "#555555", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "'Inter', sans-serif" }}>
            Total Campaigns
          </div>
        </div>

        {/* Active on Store */}
        <div style={{ ...plainCardStyle, padding: "12px 14px", minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ fontSize: "22px", fontWeight: 600, color: "#334155", lineHeight: 1, fontFamily: "'Inter', sans-serif" }}>
            {activeCount}
          </div>
          <div style={{ fontSize: "12px", fontWeight: 500, color: "#555555", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "'Inter', sans-serif" }}>
            Active on Store
          </div>
        </div>

        {/* Total Redeemed */}
        <div style={{ ...plainCardStyle, padding: "12px 14px", minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ fontSize: "22px", fontWeight: 600, color: "#2563eb", lineHeight: 1, fontFamily: "'Inter', sans-serif" }}>
            {stats.totalRedemptions}
          </div>
          <div style={{ fontSize: "12px", fontWeight: 500, color: "#555555", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "'Inter', sans-serif" }}>
            Total Redeemed
          </div>
        </div>

        {/* Customer Savings */}
        <div style={{ ...plainCardStyle, padding: "12px 14px", minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ fontSize: "22px", fontWeight: 600, color: "#059669", lineHeight: 1, fontFamily: "'Inter', sans-serif" }}>
            ₹{stats.totalSavings.toLocaleString("en-IN")}
          </div>
          <div style={{ fontSize: "12px", fontWeight: 500, color: "#555555", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "'Inter', sans-serif" }}>
            Customer Savings
          </div>
        </div>

        {/* Expiring Soon */}
        <div style={{ ...plainCardStyle, padding: "12px 14px", minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ fontSize: "22px", fontWeight: 600, color: expiringSoonCount > 0 ? "#d97706" : "#64748b", lineHeight: 1, fontFamily: "'Inter', sans-serif" }}>
            {expiringSoonCount}
          </div>
          <div style={{ fontSize: "12px", fontWeight: 500, color: "#555555", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "'Inter', sans-serif" }}>
            Expiring Soon
          </div>
        </div>
      </div>

      {/* 3. STATUS FILTER TABS & ACTION TOOLBAR */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "16px",
          borderBottom: "1px solid #e2e8f0",
          marginTop: "4px",
        }}
      >
        {/* Status Navigation Tabs */}
        <div
          style={{
            display: "flex",
            gap: "4px",
            overflowX: "auto",
            whiteSpace: "nowrap",
            flex: "1 1 auto",
            minWidth: 0,
            scrollbarWidth: "none",
          }}
        >
          {[
            { key: "all", label: "All Discounts", count: coupons.length },
            { key: "active", label: "Active (Live)", count: activeCount },
            { key: "paused", label: "Paused", count: pausedCount },
            { key: "expired", label: "Expired", count: expiredCount },
          ].map((tab) => {
            const isActive = statusFilter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setSelectedIds(new Set());
                  setStatusFilter(tab.key as any);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 12px",
                  border: "none",
                  borderBottom: isActive ? "2px solid #2563eb" : "2px solid transparent",
                  background: "transparent",
                  color: isActive ? "#2563eb" : "#64748b",
                  fontSize: "13px",
                  fontWeight: isActive ? 700 : 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  marginBottom: "-1px",
                  transition: "all 0.15s ease",
                  flexShrink: 0,
                }}
              >
                <span>{tab.label}</span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: "10px",
                    background: isActive ? "#dbeafe" : "#f1f5f9",
                    color: isActive ? "#1e40af" : "#64748b",
                  }}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right Action Toolbar: Bulk Actions or Add Promo Code */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, paddingBottom: "6px" }}>
          {selectedIds.size > 0 ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                padding: "3px 4px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}
            >
              {/* Selection Count Pill */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: "5px",
                  padding: "4px 8px",
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "#1d4ed8",
                  whiteSpace: "nowrap",
                }}
              >
                <span>{selectedIds.size} Selected</span>
              </div>

              <div style={{ width: "1px", height: "16px", background: "#e2e8f0", margin: "0 2px" }} />

              {/* Bulk Activate / Resume */}
              <button
                type="button"
                disabled={bulkLoading}
                onClick={() => handleBulkSetStatus(true)}
                title="Activate selected promo codes"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "5px 10px",
                  fontSize: "12px",
                  fontWeight: 600,
                  borderRadius: "5px",
                  border: "1px solid #bbf7d0",
                  background: "#f0fdf4",
                  color: "#166534",
                  cursor: bulkLoading ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
              >
                <CheckCircleIcon />
                <span>{bulkLoading ? "Updating..." : "Activate"}</span>
              </button>

              {/* Bulk Pause */}
              <button
                type="button"
                disabled={bulkLoading}
                onClick={() => handleBulkSetStatus(false)}
                title="Pause selected promo codes"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "5px 10px",
                  fontSize: "12px",
                  fontWeight: 600,
                  borderRadius: "5px",
                  border: "1px solid #fde68a",
                  background: "#fffbeb",
                  color: "#b45309",
                  cursor: bulkLoading ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
              >
                <PauseCircleIcon />
                <span>{bulkLoading ? "Updating..." : "Pause"}</span>
              </button>

              {/* Bulk Delete */}
              <button
                type="button"
                disabled={bulkLoading}
                onClick={handleBulkDelete}
                title="Delete selected promo codes"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "5px 10px",
                  fontSize: "12px",
                  fontWeight: 600,
                  borderRadius: "5px",
                  border: "1px solid #fecaca",
                  background: "#fef2f2",
                  color: "#dc2626",
                  cursor: bulkLoading ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
              >
                <TrashIcon />
                <span>Delete</span>
              </button>

              <div style={{ width: "1px", height: "16px", background: "#e2e8f0", margin: "0 2px" }} />

              {/* Clear Selection Button */}
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                title="Clear selection"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "26px",
                  height: "26px",
                  borderRadius: "4px",
                  border: "none",
                  background: "transparent",
                  color: "#64748b",
                  cursor: "pointer",
                  padding: 0,
                  transition: "all 0.15s ease",
                }}
              >
                <XMarkIcon />
              </button>
            </div>
          ) : (
            canCreateDiscounts && (
              <button
                type="button"
                onClick={handleOpenCreateModal}
                style={{
                  background: "#2563eb",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "5px 13px",
                  height: "32px",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  boxShadow: "0 1px 2px rgba(37,99,235,0.2)",
                  transition: "all 0.15s ease",
                  whiteSpace: "nowrap",
                  boxSizing: "border-box",
                }}
              >
                <PlusIcon />
                <span>Add Promo Code</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* 4. MAIN DATA TABLE CARD */}
      <div style={{ ...plainCardStyle, overflow: "hidden", position: "relative" }}>
        {/* Loading Shimmer Bar */}
        {loading && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "2.5px",
              background: "linear-gradient(90deg, #3b82f6 0%, #60a5fa 50%, #2563eb 100%)",
              backgroundSize: "200% 100%",
              animation: "storeShimmer 1.2s infinite linear",
              zIndex: 20,
            }}
          />
        )}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
            <thead style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
              <tr style={{ color: "#64748b" }}>
                <th style={{ ...thStyle, width: "36px", textAlign: "center", padding: "10px 12px" }}>
                  <input
                    type="checkbox"
                    checked={filteredCoupons.length > 0 && filteredCoupons.every((c) => selectedIds.has(c.id))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        const next = new Set(selectedIds);
                        filteredCoupons.forEach((c) => next.add(c.id));
                        setSelectedIds(next);
                      } else {
                        const next = new Set(selectedIds);
                        filteredCoupons.forEach((c) => next.delete(c.id));
                        setSelectedIds(next);
                      }
                    }}
                    style={{ cursor: "pointer", width: "15px", height: "15px" }}
                  />
                </th>
                <th style={thStyle}>Discount Code & Details</th>
                <th style={thStyle}>Value & Type</th>
                <th style={thStyle}>Conditions & Limits</th>
                <th style={thStyle}>Usage & Status</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>

            <tbody style={{ opacity: loading && coupons.length > 0 ? 0.6 : 1, transition: "opacity 0.12s ease" }}>
              {loading && coupons.length === 0 ? (
                [...Array(4)].map((_, idx) => (
                  <tr key={`skel-row-${idx}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ ...tdStyle, width: "36px", textAlign: "center" }}>
                      <div style={{ width: "15px", height: "15px", background: "#f1f5f9", borderRadius: "4px", margin: "0 auto" }} />
                    </td>
                    <td style={tdStyle}>
                      <div style={{ height: "16px", width: "120px", borderRadius: "4px", background: "#f1f5f9" }} />
                    </td>
                    <td style={tdStyle}>
                      <div style={{ height: "16px", width: "80px", borderRadius: "4px", background: "#f1f5f9" }} />
                    </td>
                    <td style={tdStyle}>
                      <div style={{ height: "16px", width: "140px", borderRadius: "4px", background: "#f1f5f9" }} />
                    </td>
                    <td style={tdStyle}>
                      <div style={{ height: "16px", width: "90px", borderRadius: "4px", background: "#f1f5f9" }} />
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <div style={{ height: "26px", width: "80px", borderRadius: "6px", background: "#f1f5f9", marginLeft: "auto" }} />
                    </td>
                  </tr>
                ))
              ) : filteredCoupons.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...tdStyle, textAlign: "center", padding: "48px 16px" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", maxWidth: "340px", margin: "0 auto" }}>
                      <div style={{ display: "inline-flex", padding: "10px", borderRadius: "50%", background: "#f1f5f9", color: "#64748b" }}>
                        <TagIcon size={24} />
                      </div>
                      <span style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>No discount promo codes found</span>
                      <span style={{ fontSize: "12.5px", color: "#64748b" }}>
                        {searchQuery ? "Try refining your search terms or filters." : "Create your first discount coupon to boost sales."}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCoupons.map((coupon) => {
                  const expired = isExpired(coupon);
                  const isSelected = selectedIds.has(coupon.id);

                  return (
                    <tr
                      key={coupon.id}
                      style={{
                        background: isSelected ? "#eff6ff" : "transparent",
                        transition: "background 0.1s ease",
                      }}
                    >
                      {/* Checkbox */}
                      <td style={{ ...tdStyle, width: "36px", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(coupon.id);
                            else next.delete(coupon.id);
                            setSelectedIds(next);
                          }}
                          style={{ cursor: "pointer", width: "15px", height: "15px" }}
                        />
                      </td>

                      {/* Code & Details */}
                      <td style={tdStyle}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span
                              style={{
                                fontFamily: "monospace",
                                fontWeight: 800,
                                fontSize: "13.5px",
                                color: "#0f172a",
                                background: "#f1f5f9",
                                border: "1px solid #e2e8f0",
                                borderRadius: "5px",
                                padding: "2px 7px",
                                letterSpacing: "0.05em",
                              }}
                            >
                              {coupon.code}
                            </span>
                            {coupon.isPublic === false ? (
                              <span style={{ fontSize: "10px", fontWeight: 700, color: "#64748b", background: "#f1f5f9", border: "1px solid #cbd5e1", padding: "1px 5px", borderRadius: "4px" }}>
                                Secret Code
                              </span>
                            ) : (
                              <span style={{ fontSize: "10px", fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe", padding: "1px 5px", borderRadius: "4px" }}>
                                Public
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleCopyCode(coupon.code)}
                              title="Copy code"
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                color: "#64748b",
                                padding: "3px",
                                display: "grid",
                                placeItems: "center",
                                borderRadius: "4px",
                              }}
                            >
                              <CopyIcon />
                            </button>
                          </div>
                          {coupon.description && (
                            <span style={{ fontSize: "12px", color: "#64748b", maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {coupon.description}
                            </span>
                          )}
                          <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                            Created {new Date(coupon.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </td>

                      {/* Value & Type */}
                      <td style={tdStyle}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                          <span
                            style={{
                              fontSize: "13.5px",
                              fontWeight: 700,
                              color: coupon.discountType === "free_shipping" ? "#059669" : "#2563eb",
                            }}
                          >
                            {coupon.discountType === "percentage"
                              ? `${coupon.discountValue}% OFF`
                              : coupon.discountType === "free_shipping"
                              ? "Free Shipping"
                              : `₹${coupon.discountValue} Flat OFF`}
                          </span>
                          {coupon.discountType === "percentage" && coupon.maxDiscountAmount ? (
                            <span style={{ fontSize: "11.5px", color: "#64748b" }}>
                              Up to ₹{coupon.maxDiscountAmount}
                            </span>
                          ) : null}
                          <span style={{ fontSize: "11px", color: "#94a3b8", textTransform: "capitalize" }}>
                            {coupon.discountType.replace("_", " ")}
                          </span>
                        </div>
                      </td>

                      {/* Conditions & Limits */}
                      <td style={tdStyle}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                          <span style={{ fontSize: "12.5px", color: "#334155", fontWeight: 600 }}>
                            {coupon.minOrderValue > 0 ? `Min order: ₹${coupon.minOrderValue}` : "No min subtotal"}
                          </span>
                          <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                            {coupon.isFirstOrderOnly && (
                              <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#d97706", background: "#fffbeb", border: "1px solid #fde68a", padding: "0 5px", borderRadius: "3px" }}>
                                1st Order Only
                              </span>
                            )}
                            <span style={{ fontSize: "11px", color: "#64748b" }}>
                              {coupon.perCustomerLimit === 1 ? "1 per customer" : `${coupon.perCustomerLimit}x per user`}
                            </span>
                          </div>

                          {/* Targeting Scope Badge */}
                          <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", marginTop: "1px" }}>
                            {coupon.appliesTo === "collections" ? (
                              <span
                                title={coupon.collectionIds?.map((id) => collectionNameMap.get(id) || id).join(", ")}
                                style={{
                                  fontSize: "10.5px",
                                  fontWeight: 700,
                                  color: "#7c3aed",
                                  background: "#f5f3ff",
                                  border: "1px solid #ddd6fe",
                                  padding: "1px 5px",
                                  borderRadius: "3px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "3px",
                                }}
                              >
                                <span>Collections ({coupon.collectionIds?.length || 0})</span>
                              </span>
                            ) : coupon.appliesTo === "categories" ? (
                              <span
                                title={coupon.categoryIds?.map((id) => categoryNameMap.get(id) || id).join(", ")}
                                style={{
                                  fontSize: "10.5px",
                                  fontWeight: 700,
                                  color: "#0891b2",
                                  background: "#ecfeff",
                                  border: "1px solid #a5f3fc",
                                  padding: "1px 5px",
                                  borderRadius: "3px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "3px",
                                }}
                              >
                                <span>Categories ({coupon.categoryIds?.length || 0})</span>
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: "10.5px",
                                  fontWeight: 600,
                                  color: "#64748b",
                                  background: "#f8fafc",
                                  border: "1px solid #e2e8f0",
                                  padding: "1px 5px",
                                  borderRadius: "3px",
                                }}
                              >
                                All Products
                              </span>
                            )}
                          </div>

                          {coupon.expiresAt && (
                            <span style={{ fontSize: "11px", color: expired ? "#dc2626" : isExpiringSoon(coupon) ? "#d97706" : "#64748b" }}>
                              {expired ? "Expired " : "Expires "} {new Date(coupon.expiresAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Usage & Status */}
                      <td style={tdStyle}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "5px", minWidth: "120px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#0f172a" }}>
                              {coupon.timesUsed} {coupon.totalUsageLimit ? `/ ${coupon.totalUsageLimit}` : "used"}
                            </span>
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: 700,
                                padding: "1px 6px",
                                borderRadius: "4px",
                                background: expired ? "#fef2f2" : coupon.isActive ? "#f0fdf4" : "#f8fafc",
                                color: expired ? "#dc2626" : coupon.isActive ? "#16a34a" : "#64748b",
                                border: `1px solid ${expired ? "#fecaca" : coupon.isActive ? "#bbf7d0" : "#e2e8f0"}`,
                              }}
                            >
                              {expired ? "Expired" : coupon.isActive ? "Live" : "Paused"}
                            </span>
                          </div>

                          {/* Progress bar if usage limit set */}
                          {coupon.totalUsageLimit && (
                            <div style={{ width: "100%", height: "5px", background: "#e2e8f0", borderRadius: "3px", overflow: "hidden" }}>
                              <div
                                style={{
                                  height: "100%",
                                  width: `${Math.min((coupon.timesUsed / coupon.totalUsageLimit) * 100, 100)}%`,
                                  background: (coupon.timesUsed / coupon.totalUsageLimit) >= 0.9 ? "#ef4444" : "#2563eb",
                                  borderRadius: "3px",
                                }}
                              />
                            </div>
                          )}

                          <span style={{ fontSize: "11px", color: "#059669", fontWeight: 600 }}>
                            Saved ₹{coupon.totalSavings.toLocaleString("en-IN")}
                          </span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          {/* Toggle Active Switch Button */}
                          {canEditDiscounts && (
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(coupon)}
                              title={coupon.isActive ? "Pause discount" : "Activate discount"}
                              style={{
                                padding: "4px 8px",
                                height: "28px",
                                borderRadius: "5px",
                                border: "1px solid #cbd5e1",
                                background: coupon.isActive ? "#ffffff" : "#f1f5f9",
                                color: coupon.isActive ? "#16a34a" : "#64748b",
                                fontSize: "11.5px",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {coupon.isActive ? "Pause" : "Resume"}
                            </button>
                          )}

                          {/* Edit Button */}
                          {canEditDiscounts && (
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(coupon)}
                              title="Edit discount"
                              style={{
                                width: "28px",
                                height: "28px",
                                borderRadius: "5px",
                                border: "1px solid #cbd5e1",
                                background: "#ffffff",
                                color: "#334155",
                                cursor: "pointer",
                                display: "grid",
                                placeItems: "center",
                              }}
                            >
                              <EditIcon />
                            </button>
                          )}

                          {/* Delete Button */}
                          {canDeleteDiscounts && (
                            <button
                              type="button"
                              onClick={() => handleDeleteCoupon(coupon)}
                              title="Delete discount"
                              style={{
                                width: "28px",
                                height: "28px",
                                borderRadius: "5px",
                                border: "1px solid #fecaca",
                                background: "#ffffff",
                                color: "#dc2626",
                                cursor: "pointer",
                                display: "grid",
                                placeItems: "center",
                              }}
                            >
                              <TrashIcon />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. CREATE / EDIT MODAL - ORGANIZED 2-COLUMN INDUSTRIAL DESIGN */}
      {isModalOpen && (
        <div
          style={{
            position: "fixed",
            top: "64px",
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.65)",
            zIndex: 1000,
            overflowY: "auto",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 16px 48px",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsModalOpen(false);
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "12px",
              width: "100%",
              maxWidth: "840px",
              boxShadow: "0 24px 48px rgba(0,0,0,0.25)",
              border: "1px solid #cbd5e1",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              marginBottom: "32px",
            }}
          >
            {/* Sticky Header */}
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "14px 20px",
                borderBottom: "1px solid #e2e8f0",
                background: "#ffffff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                  {editingCoupon ? `Edit Promo Code: ${editingCoupon.code}` : "Add New Promo Code"}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                {/* Live / Draft Toggle */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "#f8fafc",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: formIsActive ? "#15803d" : "#64748b",
                    }}
                  >
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: formIsActive ? "#16a34a" : "#94a3b8",
                        display: "inline-block",
                      }}
                    />
                    <span>{formIsActive ? "Active on Store" : "Paused"}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={formIsActive}
                    onChange={(e) => setFormIsActive(e.target.checked)}
                    style={{ cursor: "pointer", width: "15px", height: "15px" }}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    fontSize: "18px",
                    cursor: "pointer",
                    color: "#64748b",
                    padding: "4px",
                    lineHeight: 1,
                    display: "grid",
                    placeItems: "center",
                  }}
                  title="Close form"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Form Body - Structured 2-Column Grid */}
            <form onSubmit={handleSaveCoupon} style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
                  gap: "14px",
                  padding: "16px 20px",
                  background: "#f8fafc",
                }}
              >
                {/* Left Column */}
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  {/* Card 1: General Info */}
                  <div style={{ background: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #f1f5f9", paddingBottom: "6px" }}>
                      General Details
                    </div>

                    {/* Promo Code Input */}
                    <div>
                      <label style={labelStyle}>Promo Code *</label>
                      <div style={{ display: "flex", gap: "8px" }}>
                        <input
                          type="text"
                          value={formCode}
                          onChange={(e) => {
                            setFormCode(e.target.value.toUpperCase());
                            if (formErrors.code) setFormErrors((prev) => ({ ...prev, code: "" }));
                          }}
                          placeholder="e.g. SUMMER20"
                          style={{
                            ...inputStyle,
                            fontFamily: "monospace",
                            fontWeight: 700,
                            letterSpacing: "0.05em",
                            border: formErrors.code ? "1px solid #ef4444" : inputStyle.border,
                          }}
                        />
                        <button
                          type="button"
                          onClick={generateRandomCode}
                          style={{
                            height: "36px",
                            padding: "0 10px",
                            background: "#f1f5f9",
                            border: "1px solid #cbd5e1",
                            borderRadius: "7px",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "#334155",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <DiceIcon />
                          <span>Generate</span>
                        </button>
                      </div>
                      <ErrorBadge message={formErrors.code} />
                    </div>

                    {/* Campaign Title / Description */}
                    <div>
                      <label style={labelStyle}>Description (Optional)</label>
                      <input
                        type="text"
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                        placeholder="e.g. Summer special 20% discount"
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  {/* Card 2: Discount Value & Calculation */}
                  <div style={{ background: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #f1f5f9", paddingBottom: "6px" }}>
                      Discount Type & Amount
                    </div>

                    {/* Discount Type 3-Pill Toggle */}
                    <div>
                      <label style={labelStyle}>Discount Type *</label>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
                        {[
                          { type: "percentage", label: "% Percentage" },
                          { type: "fixed_amount", label: "₹ Flat Amount" },
                          { type: "free_shipping", label: "Free Shipping" },
                        ].map((t) => (
                          <button
                            key={t.type}
                            type="button"
                            onClick={() => {
                              setFormType(t.type as any);
                              setFormErrors((prev) => ({ ...prev, value: "", maxCap: "" }));
                            }}
                            style={{
                              padding: "8px 4px",
                              borderRadius: "6px",
                              border: formType === t.type ? "2px solid #2563eb" : "1px solid #cbd5e1",
                              background: formType === t.type ? "#eff6ff" : "#ffffff",
                              color: formType === t.type ? "#1d4ed8" : "#334155",
                              fontSize: "12px",
                              fontWeight: 700,
                              cursor: "pointer",
                              textAlign: "center",
                              transition: "all 0.15s ease",
                            }}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Value and Max Cap */}
                    {formType !== "free_shipping" && (
                      <div style={{ display: "grid", gridTemplateColumns: formType === "percentage" ? "1fr 1fr" : "1fr", gap: "10px" }}>
                        <div>
                          <label style={labelStyle}>
                            {formType === "percentage" ? "Discount (%) *" : "Discount Amount (₹) *"}
                          </label>
                          <input
                            type="number"
                            min="0"
                            max={formType === "percentage" ? "100" : undefined}
                            step="any"
                            value={formValue}
                            onChange={(e) => {
                              setFormValue(e.target.value);
                              if (formErrors.value) setFormErrors((prev) => ({ ...prev, value: "" }));
                            }}
                            style={{
                              ...inputStyle,
                              border: formErrors.value ? "1px solid #ef4444" : inputStyle.border,
                            }}
                          />
                          <ErrorBadge message={formErrors.value} />
                        </div>

                        {formType === "percentage" && (
                          <div>
                            <label style={labelStyle}>Max Savings Cap (₹)</label>
                            <input
                              type="number"
                              min="0"
                              placeholder="No limit"
                              value={formMaxCap}
                              onChange={(e) => {
                                setFormMaxCap(e.target.value);
                                if (formErrors.maxCap) setFormErrors((prev) => ({ ...prev, maxCap: "" }));
                              }}
                              style={{
                                ...inputStyle,
                                border: formErrors.maxCap ? "1px solid #ef4444" : inputStyle.border,
                              }}
                            />
                            <ErrorBadge message={formErrors.maxCap} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Card 3: Targeting & Scope */}
                  <div style={{ background: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #f1f5f9", paddingBottom: "6px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        Applicability & Targeting
                      </div>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: "#64748b" }}>
                        {formAppliesTo === "all" ? "All Products" : formAppliesTo === "collections" ? `${formCollectionIds.length} Selected` : `${formCategoryIds.length} Selected`}
                      </span>
                    </div>

                    {/* Scope 3-Pill Switcher */}
                    <div>
                      <label style={labelStyle}>Applies To *</label>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
                        {[
                          { id: "all", label: "All Products" },
                          { id: "collections", label: "Collections" },
                          { id: "categories", label: "Categories" },
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setFormAppliesTo(opt.id as any);
                              if (formErrors.targeting) setFormErrors((prev) => ({ ...prev, targeting: "" }));
                            }}
                            style={{
                              padding: "7px 4px",
                              borderRadius: "6px",
                              border: formAppliesTo === opt.id ? "2px solid #2563eb" : "1px solid #cbd5e1",
                              background: formAppliesTo === opt.id ? "#eff6ff" : "#ffffff",
                              color: formAppliesTo === opt.id ? "#1d4ed8" : "#334155",
                              fontSize: "11.5px",
                              fontWeight: 700,
                              cursor: "pointer",
                              textAlign: "center",
                              transition: "all 0.15s ease",
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Collections Picker */}
                    {formAppliesTo === "collections" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div style={{ fontSize: "12px", color: "#64748b" }}>
                          Discount will only apply to items belonging to selected collections.
                        </div>

                        {/* Search input for collections */}
                        <div style={{ position: "relative" }}>
                          <input
                            type="text"
                            value={collectionsSearch}
                            onChange={(e) => setCollectionsSearch(e.target.value)}
                            placeholder="Search store collections..."
                            style={{ ...inputStyle, height: "32px", fontSize: "12px" }}
                          />
                        </div>

                        {/* Selected Collections Tags */}
                        {formCollectionIds.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", padding: "4px 0" }}>
                            {formCollectionIds.map((id) => {
                              const name = collectionNameMap.get(id) || id;
                              return (
                                <span
                                  key={id}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    background: "#f5f3ff",
                                    border: "1px solid #ddd6fe",
                                    color: "#6d28d9",
                                    borderRadius: "4px",
                                    padding: "2px 8px",
                                    fontSize: "11.5px",
                                    fontWeight: 600,
                                  }}
                                >
                                  <span>{name}</span>
                                  <button
                                    type="button"
                                    onClick={() => setFormCollectionIds((prev) => prev.filter((item) => item !== id))}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      color: "#6d28d9",
                                      cursor: "pointer",
                                      padding: 0,
                                      fontSize: "12px",
                                      lineHeight: 1,
                                    }}
                                  >
                                    ✕
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}

                        {/* Collections Checklist / Grid */}
                        <div
                          style={{
                            maxHeight: "150px",
                            overflowY: "auto",
                            border: "1px solid #e2e8f0",
                            borderRadius: "6px",
                            padding: "6px",
                            background: "#f8fafc",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                          }}
                        >
                          {storeCollections.length === 0 ? (
                            <div style={{ fontSize: "12px", color: "#94a3b8", padding: "8px", textAlign: "center" }}>
                              No collections found in this store.
                            </div>
                          ) : (
                            storeCollections
                              .filter((c) => !collectionsSearch.trim() || c.name.toLowerCase().includes(collectionsSearch.toLowerCase()))
                              .map((c) => {
                                const isChecked = formCollectionIds.includes(c.id);
                                return (
                                  <label
                                    key={c.id}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      padding: "5px 8px",
                                      borderRadius: "4px",
                                      background: isChecked ? "#ffffff" : "transparent",
                                      cursor: "pointer",
                                      fontSize: "12.5px",
                                      color: "#1e293b",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setFormCollectionIds((prev) => [...prev, c.id]);
                                        } else {
                                          setFormCollectionIds((prev) => prev.filter((id) => id !== c.id));
                                        }
                                        if (formErrors.targeting) setFormErrors((prev) => ({ ...prev, targeting: "" }));
                                      }}
                                      style={{ cursor: "pointer", width: "14px", height: "14px" }}
                                    />
                                    <span>{c.name}</span>
                                  </label>
                                );
                              })
                          )}
                        </div>
                        <ErrorBadge message={formErrors.targeting} />
                      </div>
                    )}

                    {/* Categories Picker */}
                    {formAppliesTo === "categories" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div style={{ fontSize: "12px", color: "#64748b" }}>
                          Discount will only apply to items belonging to selected categories.
                        </div>

                        {/* Search input for categories */}
                        <div style={{ position: "relative" }}>
                          <input
                            type="text"
                            value={categoriesSearch}
                            onChange={(e) => setCategoriesSearch(e.target.value)}
                            placeholder="Search store categories..."
                            style={{ ...inputStyle, height: "32px", fontSize: "12px" }}
                          />
                        </div>

                        {/* Selected Categories Tags */}
                        {formCategoryIds.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", padding: "4px 0" }}>
                            {formCategoryIds.map((id) => {
                              const name = categoryNameMap.get(id) || id;
                              return (
                                <span
                                  key={id}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    background: "#ecfeff",
                                    border: "1px solid #a5f3fc",
                                    color: "#0e7490",
                                    borderRadius: "4px",
                                    padding: "2px 8px",
                                    fontSize: "11.5px",
                                    fontWeight: 600,
                                  }}
                                >
                                  <span>{name}</span>
                                  <button
                                    type="button"
                                    onClick={() => setFormCategoryIds((prev) => prev.filter((item) => item !== id))}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      color: "#0e7490",
                                      cursor: "pointer",
                                      padding: 0,
                                      fontSize: "12px",
                                      lineHeight: 1,
                                    }}
                                  >
                                    ✕
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}

                        {/* Categories Checklist / Grid */}
                        <div
                          style={{
                            maxHeight: "150px",
                            overflowY: "auto",
                            border: "1px solid #e2e8f0",
                            borderRadius: "6px",
                            padding: "6px",
                            background: "#f8fafc",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                          }}
                        >
                          {storeCategories.length === 0 ? (
                            <div style={{ fontSize: "12px", color: "#94a3b8", padding: "8px", textAlign: "center" }}>
                              No categories found in this store.
                            </div>
                          ) : (
                            storeCategories
                              .filter((c) => !categoriesSearch.trim() || c.name.toLowerCase().includes(categoriesSearch.toLowerCase()))
                              .map((c) => {
                                const isChecked = formCategoryIds.includes(c.id);
                                return (
                                  <label
                                    key={c.id}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      padding: "5px 8px",
                                      borderRadius: "4px",
                                      background: isChecked ? "#ffffff" : "transparent",
                                      cursor: "pointer",
                                      fontSize: "12.5px",
                                      color: "#1e293b",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setFormCategoryIds((prev) => [...prev, c.id]);
                                        } else {
                                          setFormCategoryIds((prev) => prev.filter((id) => id !== c.id));
                                        }
                                        if (formErrors.targeting) setFormErrors((prev) => ({ ...prev, targeting: "" }));
                                      }}
                                      style={{ cursor: "pointer", width: "14px", height: "14px" }}
                                    />
                                    <span>{c.name}</span>
                                  </label>
                                );
                              })
                          )}
                        </div>
                        <ErrorBadge message={formErrors.targeting} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column */}
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  {/* Card 3: Conditions & Rules */}
                  <div style={{ background: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #f1f5f9", paddingBottom: "6px" }}>
                      Eligibility & Limits
                    </div>

                    {/* Minimum Order Subtotal */}
                    <div>
                      <label style={labelStyle}>Minimum Order Subtotal (₹)</label>
                      <input
                        type="number"
                        min="0"
                        placeholder="0 = No minimum"
                        value={formMinOrder}
                        onChange={(e) => {
                          setFormMinOrder(e.target.value);
                          if (formErrors.minOrder) setFormErrors((prev) => ({ ...prev, minOrder: "" }));
                        }}
                        style={{
                          ...inputStyle,
                          border: formErrors.minOrder ? "1px solid #ef4444" : inputStyle.border,
                        }}
                      />
                      <ErrorBadge message={formErrors.minOrder} />
                    </div>

                    {/* Total Storewide Limit & Per Customer Limit */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px", width: "100%", boxSizing: "border-box" }}>
                      <div style={{ minWidth: 0, overflow: "hidden" }}>
                        <label style={labelStyle}>Total Usage Limit</label>
                        <input
                          type="number"
                          min="1"
                          placeholder="Unlimited"
                          value={formTotalLimit}
                          onChange={(e) => {
                            setFormTotalLimit(e.target.value);
                            if (formErrors.totalLimit) setFormErrors((prev) => ({ ...prev, totalLimit: "" }));
                          }}
                          style={{
                            ...inputStyle,
                            width: "100%",
                            maxWidth: "100%",
                            minWidth: 0,
                            boxSizing: "border-box",
                            border: formErrors.totalLimit ? "1px solid #ef4444" : inputStyle.border,
                          }}
                        />
                        <ErrorBadge message={formErrors.totalLimit} />
                      </div>

                      <div style={{ minWidth: 0, overflow: "hidden" }}>
                        <label style={labelStyle}>Limit Per Customer</label>
                        <input
                          type="number"
                          min="1"
                          value={formPerCustomerLimit}
                          onChange={(e) => {
                            setFormPerCustomerLimit(e.target.value);
                            if (formErrors.perCustomer) setFormErrors((prev) => ({ ...prev, perCustomer: "" }));
                          }}
                          style={{
                            ...inputStyle,
                            width: "100%",
                            maxWidth: "100%",
                            minWidth: 0,
                            boxSizing: "border-box",
                            border: formErrors.perCustomer ? "1px solid #ef4444" : inputStyle.border,
                          }}
                        />
                        <ErrorBadge message={formErrors.perCustomer} />
                      </div>
                    </div>

                    {/* First Order Restriction Checkbox */}
                    <div style={{ paddingTop: "4px", display: "flex", flexDirection: "column", gap: "10px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "12.5px", fontWeight: 600, color: "#1e293b" }}>
                        <input
                          type="checkbox"
                          checked={formFirstOrderOnly}
                          onChange={(e) => setFormFirstOrderOnly(e.target.checked)}
                          style={{ width: "15px", height: "15px", cursor: "pointer" }}
                        />
                        <span>First-time customers only</span>
                      </label>

                      {/* Public on Storefront Checkbox */}
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "12.5px", fontWeight: 600, color: "#1e293b" }}>
                        <input
                          type="checkbox"
                          checked={formIsPublic}
                          onChange={(e) => setFormIsPublic(e.target.checked)}
                          style={{ width: "15px", height: "15px", cursor: "pointer" }}
                        />
                        <span>Show in Available Offers list</span>
                      </label>
                    </div>
                  </div>

                  {/* Card 4: Date Schedule */}
                  <div style={{ background: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: "1px solid #f1f5f9", paddingBottom: "6px" }}>
                      Validity Schedule
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px", width: "100%", boxSizing: "border-box" }}>
                      <div style={{ minWidth: 0, overflow: "hidden" }}>
                        <label style={labelStyle}>Starts At</label>
                        <input
                          type="datetime-local"
                          value={formStartsAt}
                          onChange={(e) => {
                            setFormStartsAt(e.target.value);
                            if (formErrors.expiresAt) setFormErrors((prev) => ({ ...prev, expiresAt: "" }));
                          }}
                          style={{
                            ...inputStyle,
                            width: "100%",
                            maxWidth: "100%",
                            minWidth: 0,
                            boxSizing: "border-box",
                            fontSize: "12px",
                            padding: "0 6px",
                          }}
                        />
                      </div>

                      <div style={{ minWidth: 0, overflow: "hidden" }}>
                        <label style={labelStyle}>Expires At</label>
                        <input
                          type="datetime-local"
                          value={formExpiresAt}
                          onChange={(e) => {
                            setFormExpiresAt(e.target.value);
                            if (formErrors.expiresAt) setFormErrors((prev) => ({ ...prev, expiresAt: "" }));
                          }}
                          style={{
                            ...inputStyle,
                            width: "100%",
                            maxWidth: "100%",
                            minWidth: 0,
                            boxSizing: "border-box",
                            fontSize: "12px",
                            padding: "0 6px",
                            border: formErrors.expiresAt ? "1px solid #ef4444" : inputStyle.border,
                          }}
                        />
                        <ErrorBadge message={formErrors.expiresAt} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sticky Footer */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "10px",
                  padding: "12px 20px",
                  borderTop: "1px solid #e2e8f0",
                  background: "#ffffff",
                }}
              >
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{
                    height: "34px",
                    padding: "0 16px",
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    color: "#475569",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    height: "34px",
                    padding: "0 18px",
                    background: "#2563eb",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "12.5px",
                    fontWeight: 700,
                    cursor: saving ? "not-allowed" : "pointer",
                    opacity: saving ? 0.7 : 1,
                    boxShadow: "0 1px 2px rgba(37,99,235,0.2)",
                  }}
                >
                  {saving ? "Saving..." : editingCoupon ? "Save Changes" : "Create Promo Code"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
