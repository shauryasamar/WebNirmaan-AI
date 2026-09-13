import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { API_BASE_URL } from "../config/api";
import { getCustomerAuthHeaders } from "../utils/customerAuthFetch";
import { usePublicSiteTheme } from "../hooks/usePublicSiteTheme";
import { useDeviceMode } from "../context/DeviceModeContext";
import {
  parseMessageWithMedia,
  AdaptiveSupportImage,
  SupportImageZoomModal,
  compressImageFile,
  MessageStatusTick,
} from "../Component/AdaptiveSupportMedia";

interface CustomerSupportPageProps {
  siteId?: string;
  siteSlug?: string;
  theme?: Record<string, any>;
  props?: Record<string, any>;
  [key: string]: any;
}

interface SupportCategory {
  id: string;
  label: string;
}

// In-memory LRU Cache implementation to optimize memory & prevent redundant network round-trips
class LRUCache<K = any, V = any> {
  private capacity: number;
  private cache: Map<any, any>;

  constructor(capacity = 25) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  get(key: any): any {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: any, value: any): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

const formatOrderDate = (dateStr?: string | null) => {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
};

const formatMessageDateGroup = (dateStr?: string | null) => {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
};

const formatTicketDate = formatOrderDate;
const formatDate = formatOrderDate;

const CATEGORIES: SupportCategory[] = [
  { id: "damaged_item", label: "Damaged / Broken Product" },
  { id: "delivery_delay", label: "Delivery Delay / Tracking" },
  { id: "missing_item", label: "Missing Item in Order" },
  { id: "wrong_item", label: "Wrong Item Received" },
  { id: "return_exchange", label: "Return or Exchange Inquiry" },
  { id: "cancellation", label: "Order Cancellation" },
  { id: "payment_issue", label: "Payment & Refund" },
  { id: "other", label: "General Store Inquiry" },
];

const renderCategoryIcon = (categoryId: string, size = 16) => {
  switch (categoryId) {
    case "damaged_item":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
    case "delivery_delay":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="3" width="15" height="13" />
          <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
      );
    case "missing_item":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      );
    case "wrong_item":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      );
    case "return_exchange":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      );
    case "cancellation":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    case "payment_issue":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
  }
};

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; border: string }
> = {
  open: {
    label: "Open",
    bg: "rgba(37, 99, 235, 0.08)",
    text: "#2563eb",
    border: "rgba(37, 99, 235, 0.2)",
  },
  in_progress: {
    label: "In Progress",
    bg: "rgba(124, 58, 237, 0.08)",
    text: "#7c3aed",
    border: "rgba(124, 58, 237, 0.2)",
  },
  waiting_customer: {
    label: "Specialist Replied",
    bg: "rgba(245, 158, 11, 0.08)",
    text: "#d97706",
    border: "rgba(245, 158, 11, 0.25)",
  },
  resolved: {
    label: "Resolved",
    bg: "rgba(22, 163, 74, 0.08)",
    text: "#16a34a",
    border: "rgba(22, 163, 74, 0.2)",
  },
  closed: {
    label: "Closed",
    bg: "rgba(100, 116, 139, 0.08)",
    text: "#64748b",
    border: "rgba(100, 116, 139, 0.16)",
  },
};

function parseApiError(data: any, fallback: string = "Failed to process request"): string {
  if (!data) return fallback;
  if (typeof data === "string") return data;
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) {
    return data.detail
      .map((item: any) => {
        if (typeof item === "string") return item;
        const field = Array.isArray(item.loc) ? item.loc.filter((x: any) => x !== "body").join(".") : "";
        const msg = item.msg || JSON.stringify(item);
        return field ? `${field}: ${msg}` : msg;
      })
      .join(", ") || fallback;
  }
  if (data.detail && typeof data.detail === "object") {
    if (typeof data.detail.message === "string") return data.detail.message;
    return JSON.stringify(data.detail);
  }
  if (typeof data.message === "string") return data.message;
  if (typeof data.error === "string") return data.error;
  return fallback;
}

export default function CustomerSupportPage({
  siteId: propSiteId,
  siteSlug: propSiteSlug,
  theme: propTheme,
  ...restProps
}: CustomerSupportPageProps) {
  const { siteId: routeSiteId, slug: routeSlug } = useParams<{ siteId?: string; slug?: string }>();
  const activeSlug = propSiteSlug || routeSlug || "";
  const effectiveSiteId = propSiteId || routeSiteId || activeSlug || "";
  const navigate = useNavigate();

  // Responsive Viewport Tracking (Width, Visual Viewport Height & OffsetTop for Mobile/Tablet Keyboards)
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1024
  );
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = useState<number>(0);

  useEffect(() => {
    let rafId: number | null = null;
    const handleResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setViewportWidth(window.innerWidth);
        if (typeof window !== "undefined" && window.visualViewport) {
          setViewportHeight(window.visualViewport.height);
          setViewportOffsetTop(window.visualViewport.offsetTop || 0);
        }
      });
    };
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize);
    if (typeof window !== "undefined" && window.visualViewport) {
      setViewportHeight(window.visualViewport.height);
      setViewportOffsetTop(window.visualViewport.offsetTop || 0);
      window.visualViewport.addEventListener("resize", handleResize);
      window.visualViewport.addEventListener("scroll", handleResize);
    }
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize);
      if (typeof window !== "undefined" && window.visualViewport) {
        window.visualViewport.removeEventListener("resize", handleResize);
        window.visualViewport.removeEventListener("scroll", handleResize);
      }
    };
  }, []);

  // Measure navbar height dynamically for precise single-screen fitting
  const [navbarHeight, setNavbarHeight] = useState(72);

  useEffect(() => {
    const updateNavHeight = () => {
      const navEl =
        document.getElementById("storefront-navbar") ||
        document.querySelector("header") ||
        document.querySelector('[data-editor-block-type="navbar"]');
      if (navEl && navEl.clientHeight > 0) {
        setNavbarHeight(navEl.clientHeight);
      }
    };
    updateNavHeight();
    window.addEventListener("resize", updateNavHeight);
    return () => window.removeEventListener("resize", updateNavHeight);
  }, []);

  const deviceMode = useDeviceMode();

  const effectiveViewportWidth = useMemo(() => {
    if (deviceMode === "mobile") return 390;
    return viewportWidth;
  }, [deviceMode, viewportWidth]);

  // Responsive device & tablet classification:
  // Activates the touch/tablet-optimized single-pane view (same comfortable experience as iPad Mini)
  // for:
  // - Builder mobile mode (deviceMode === "mobile")
  // - Viewport width <= 1040 (phones, iPad Mini 768px/1024px, iPad Air 820px, iPad Pro 11" 834px, Surface Pro 10 912px/960px, iPad Pro 12.9"/13" 1024px/1032px)
  // - Real Apple iPad tablets (Safari/Chrome on iPadOS report platform "MacIntel" with touch points > 1)
  // - Touch-first tablets (Surface Pro in tablet mode, Android tablets) with coarse touch
  const isMobile = useMemo(() => {
    if (deviceMode === "mobile") return true;
    if (viewportWidth <= 1040) return true;

    if (typeof window !== "undefined") {
      // Apple iPad detection (iPadOS Safari & Chrome on iPad report as MacIntel with touch points > 1)
      const isAppleTablet =
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
        /iPad|Tablet|PlayBook|Silk/i.test(navigator.userAgent);
      if (isAppleTablet) return true;

      // Detect touch-first tablets (Surface Pro in tablet mode, Android tablets)
      // where touch is coarse and viewport width is <= 1370px
      const isCoarseTouchTablet =
        navigator.maxTouchPoints > 0 &&
        window.matchMedia &&
        window.matchMedia("(pointer: coarse)").matches &&
        !window.matchMedia("(pointer: fine)").matches &&
        viewportWidth <= 1370;

      if (isCoarseTouchTablet) return true;
    }

    return false;
  }, [deviceMode, viewportWidth]);
  const isEditMode = Boolean(
    restProps?.editMode ||
    (typeof window !== "undefined" && window.location.pathname.startsWith("/builder"))
  );
  const isAdmin = isEditMode;
  const isDesktopAdmin = isEditMode && !isMobile;
  const isAdminPhoneView = isEditMode && isMobile;
  const [chatOpen, setChatOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  const adminPhoneHeight = useMemo(() => {
    // Smartphone chassis inner height in Builder preview is standard 844px
    const rawStage = 844;
    const navH = navbarHeight > 0 ? navbarHeight : 72;
    return Math.max(480, rawStage - navH);
  }, [navbarHeight]);


  // Keyboard active detection on mobile (both focus state and viewport resize)
  const isKeyboardOpen =
    isMobile &&
    chatOpen &&
    typeof window !== "undefined" &&
    viewportHeight !== null &&
    (window.innerHeight - viewportHeight > 100 ||
      (typeof window.visualViewport !== "undefined" &&
        window.visualViewport &&
        window.innerHeight - window.visualViewport.height > 100));

  const isKeyboardActive = !isAdmin && !isAdminPhoneView && isMobile && chatOpen && (isKeyboardOpen || inputFocused);

  // Auto-hide storefront navbar when keyboard is active on real mobile devices to give maximum screen space for chat
  useEffect(() => {
    if (isAdmin || isAdminPhoneView || !isMobile || !chatOpen) return;
    const navEl =
      document.getElementById("storefront-navbar") ||
      document.querySelector("header") ||
      (document.querySelector('[data-editor-block-type="navbar"]') as HTMLElement | null);

    if (navEl) {
      if (isKeyboardActive) {
        navEl.style.display = "none";
      } else {
        navEl.style.removeProperty("display");
      }
    }
    return () => {
      if (navEl) {
        navEl.style.removeProperty("display");
      }
    };
  }, [isAdmin, isAdminPhoneView, isKeyboardActive, isMobile, chatOpen]);

  // Lock mobile background window scroll when keyboard is active on real mobile devices so screen never rubber-bands
  // and outer window can never scroll the chat input up into the ceiling
  useEffect(() => {
    if (!isAdmin && !isAdminPhoneView && isMobile && chatOpen) {
      const clampScroll = () => {
        if (window.scrollY !== 0 || window.pageXOffset !== 0) {
          window.scrollTo(0, 0);
        }
        if (document.body.scrollTop !== 0) {
          document.body.scrollTop = 0;
        }
      };

      window.addEventListener("scroll", clampScroll, { passive: true });
      if (typeof window.visualViewport !== "undefined" && window.visualViewport) {
        window.visualViewport.addEventListener("scroll", clampScroll, { passive: true });
      }

      const origOverflow = document.body.style.overflow;
      const origTouchAction = document.body.style.touchAction;

      if (isKeyboardActive) {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        document.body.scrollTop = 0;
        document.body.style.overflow = "hidden";
        document.body.style.touchAction = "none";
      }

      return () => {
        window.removeEventListener("scroll", clampScroll);
        if (typeof window.visualViewport !== "undefined" && window.visualViewport) {
          window.visualViewport.removeEventListener("scroll", clampScroll);
        }
        document.body.style.overflow = origOverflow;
        document.body.style.touchAction = origTouchAction;
        if (typeof window !== "undefined") {
          window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        }
      };
    }
  }, [isAdmin, isAdminPhoneView, isMobile, chatOpen, isKeyboardActive]);

  useEffect(() => {
    if (!isAdmin && chatOpen) {
      window.scrollTo({ top: 0, behavior: "instant" });
      const builderScroll = document.querySelector(".builder-preview-scroll");
      if (builderScroll) {
        builderScroll.scrollTo({ top: 0, behavior: "instant" });
      }
    }
  }, [isAdmin, chatOpen]);

  // Read configurable block props from site editor / admin
  const blockProps = {
    ...(restProps || {}),
    ...(restProps?.props || {}),
  };
  const inquiriesTabLabel = blockProps?.inquiriesTabLabel || "Inquiries";
  const newRequestTabLabel = blockProps?.newRequestTabLabel || "+ New Request";
  const submitButtonText = blockProps?.submitButtonText || "Submit Request";
  const supportEmail = blockProps?.supportEmail || blockProps?.support_email || "";
  const supportPhone = blockProps?.supportPhone || blockProps?.support_phone || "";
  const supportHours = blockProps?.supportHours || blockProps?.support_hours || blockProps?.operatingHours || blockProps?.operating_hours || "";

  // Scroll to top on initial mount
  useEffect(() => {
    if (!isAdmin) {
      window.scrollTo(0, 0);
    }
  }, [isAdmin]);

  const { siteData } = usePublicSiteTheme(activeSlug);
  const [liveCrmOverride, setLiveCrmOverride] = useState<boolean | null>(null);

  useEffect(() => {
    const handleCrmChange = (e: Event) => {
      const ce = e as CustomEvent<{ siteId?: string; siteSlug?: string; crm_enabled: boolean }>;
      if (!ce.detail) return;
      const { siteId: targetSiteId, siteSlug: targetSiteSlug, crm_enabled } = ce.detail;
      const curSlug = activeSlug;
      if (
        (targetSiteSlug && curSlug && targetSiteSlug.toLowerCase().trim() === curSlug.toLowerCase().trim()) ||
        (targetSiteId && curSlug && targetSiteId.toLowerCase().trim() === curSlug.toLowerCase().trim())
      ) {
        setLiveCrmOverride(crm_enabled);
      }
    };
    window.addEventListener("wc_crm_status_changed", handleCrmChange);
    return () => window.removeEventListener("wc_crm_status_changed", handleCrmChange);
  }, [activeSlug]);

  const isCrmEnabled =
    liveCrmOverride !== null
      ? liveCrmOverride
      : (restProps as any)?.crm_enabled !== undefined
        ? Boolean((restProps as any).crm_enabled)
        : (restProps as any)?.siteDefinition?.crm_enabled !== undefined
          ? Boolean((restProps as any).siteDefinition.crm_enabled)
          : (propTheme as any)?.crm_enabled !== undefined
            ? Boolean((propTheme as any).crm_enabled)
            : siteData?.crm_enabled !== undefined
              ? Boolean(siteData.crm_enabled)
              : true;
  const activeTheme = propTheme || siteData?.theme || {};
  const isLight = activeTheme.mode !== "dark";

  const parseDimension = (val: any, fallback: string) => {
    if (val === undefined || val === null || val === "") return fallback;
    if (typeof val === "number") return `${val}px`;
    const s = String(val).trim();
    return s.endsWith("px") || s.endsWith("%") || s.endsWith("rem") || s.endsWith("vh") || s.endsWith("vw") ? s : `${s}px`;
  };

  const resolvedMaxWidth = useMemo(() => {
    const raw = blockProps?.max_width;
    if (!raw || raw === "100%" || raw === "full" || raw === "100") return "100%";
    if (typeof raw === "number") return `${raw}px`;
    const s = String(raw).trim();
    return s.endsWith("px") || s.endsWith("%") || s.endsWith("rem") || s.endsWith("vw") ? s : `${s}px`;
  }, [blockProps?.max_width]);

  const cardRadius = parseDimension(blockProps?.card_radius ?? blockProps?.border_radius, "12px");
  const cardPadding = parseDimension(blockProps?.card_padding ?? blockProps?.padding, isMobile ? "14px" : "20px");
  const chatRadius = parseDimension(blockProps?.chat_radius ?? blockProps?.chat_window_radius, "10px");
  const bubbleRadius = parseDimension(blockProps?.bubble_radius ?? blockProps?.chat_bubble_radius, "14px");
  const innerRadius = parseDimension(blockProps?.inner_radius, "8px");
  const inputRadius = parseDimension(blockProps?.input_radius ?? blockProps?.input_border_radius ?? blockProps?.inputRadius, "8px");
  const buttonRadius = parseDimension(blockProps?.button_radius ?? blockProps?.buttonRadius, "8px");
  const badgeRadius = parseDimension(blockProps?.badge_radius, "4px");

  // Consistent, solid theme colors without dark transparency clashes
  const accentColor = blockProps?.accent_color || activeTheme.accent_color || "#2563eb";
  const primaryBg = blockProps?.primary_bg || (isLight ? (activeTheme.primary_bg || "#f8fafc") : "#0b1120");
  const cardBg = blockProps?.card_bg || (isLight ? (activeTheme.card_bg || "#ffffff") : "#131c31");
  const surfaceBg = isLight ? "#f1f5f9" : "#1a243d";
  const chatBg = blockProps?.chat_bg || cardBg;
  const textColor = blockProps?.text_color || (isLight ? (activeTheme.text_color || "#0f172a") : "#f8fafc");
  const titleColor = blockProps?.title_color || (isLight ? (activeTheme.text_color || "#0f172a") : "#f8fafc");
  const textMuted = blockProps?.subtext_color || (isLight ? "#64748b" : "#94a3b8");
  const borderColor = blockProps?.border_color || (isLight ? (activeTheme.border_color || "#e2e8f0") : "rgba(255, 255, 255, 0.12)");
  const buttonTextColor = blockProps?.button_text_color || "#ffffff";
  const inputBg = blockProps?.input_bg || (isLight ? "#ffffff" : "#1a243d");
  const inputBorder = blockProps?.input_border || borderColor;
  const inputTextColor = blockProps?.input_text_color || textColor;
  const customerBubbleBg = blockProps?.customer_bubble_bg || accentColor;
  const customerBubbleText = blockProps?.customer_bubble_text || "#ffffff";
  const agentBubbleBg = blockProps?.agent_bubble_bg || (isLight ? "#f1f5f9" : "#1e293b");
  const agentBubbleText = blockProps?.agent_bubble_text || textColor;
  const allowOrderSelection = blockProps?.allowOrderSelection !== false;
  const allowAttachments = blockProps?.allowAttachments !== false;
  const showContactInfo = blockProps?.showContactInfo !== false;
  const siteContactEmail = (siteData as any)?.contact_email;
  const siteContactPhone = (siteData as any)?.contact_phone;

  // View State
  const [activeTab, setActiveTab] = useState<"inquiries" | "new">("inquiries");
  const [tickets, setTickets] = useState<any[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsLoadingMore, setTicketsLoadingMore] = useState(false);
  const [ticketsPage, setTicketsPage] = useState(1);
  const [ticketsTotalPages, setTicketsTotalPages] = useState(1);
  const [ticketsTotalCount, setTicketsTotalCount] = useState(0);
  // LRU cache for tickets: 5 page-slots × 8 items each = 40 max in cache memory
  const ticketsLRUCache = useRef<LRUCache<string, any>>(new LRUCache<string, any>(5));
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Active Chat State with pagination and memory cap
  const [ticketDetail, setTicketDetail] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [messagesLoadingOlder, setMessagesLoadingOlder] = useState(false);
  const [messagesPage, setMessagesPage] = useState(1);
  const [messagesTotalPages, setMessagesTotalPages] = useState(1);
  const [messagesTotalCount, setMessagesTotalCount] = useState(0);
  const [hasMoreOlderMessages, setHasMoreOlderMessages] = useState(false);
  // LRU cache for recent ticket message threads
  const ticketMessagesLRUCache = useRef<LRUCache<string, any>>(new LRUCache<string, any>(10));
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [closingTicket, setClosingTicket] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Picture Upload & Zoom State
  const [chatImage, setChatImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [uploadingChatImage, setUploadingChatImage] = useState(false);
  const [newRequestImage, setNewRequestImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [uploadingNewRequestImage, setUploadingNewRequestImage] = useState(false);
  const [activeZoomPhoto, setActiveZoomPhoto] = useState<string | null>(null);

  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const newRequestFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleDismissKeyboard = () => {
    setInputFocused(false);
    if (chatInputRef.current) {
      chatInputRef.current.blur();
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  const resolveMediaUrl = (url: string) => {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:") || url.startsWith("data:")) {
      return url;
    }
    return `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
  };

  const uploadFileToSupport = async (file: File): Promise<string> => {
    // Compress customer photo by ~90-95% to lightweight WebP before uploading
    const fileToUpload = await compressImageFile(file, 1600, 1600, 0.82);
    const formData = new FormData();
    formData.append("file", fileToUpload);
    const headers = getCustomerAuthHeaders(effectiveSiteId);
    delete headers["Content-Type"];

    const res = await fetch(`${API_BASE_URL}/sites/${effectiveSiteId}/support/upload-image`, {
      method: "POST",
      headers,
      credentials: "include",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || "Failed to upload picture");
    }
    const data = await res.json();
    return data.url;
  };

  const handlePasteImage = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const rawFile = items[i].getAsFile();
        if (rawFile) {
          const file = await compressImageFile(rawFile, 1600, 1600, 0.82);
          const previewUrl = URL.createObjectURL(file);
          setChatImage({ file, previewUrl });
          break;
        }
      }
    }
  };

  const [searchParams] = useSearchParams();
  const urlTab = searchParams.get("tab");
  const urlOrderId = searchParams.get("orderId");
  const urlItemId = searchParams.get("itemId");

  // New Request State & Product Selection
  const [ticketSearchQuery, setTicketSearchQuery] = useState("");
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersLoadingMore, setOrdersLoadingMore] = useState(false);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [ordersTotalCount, setOrdersTotalCount] = useState(0);
  // LRU cache: 5 page-slots × 6 orders each = 30 orders max in cache memory
  const ordersLRUCache = useRef<LRUCache<string, any>>(new LRUCache<string, any>(5));
  const [selectedOrderId, setSelectedOrderId] = useState<string>(urlOrderId || "");
  const [selectedOrderItemId, setSelectedOrderItemId] = useState<string>(urlItemId || "");
  const [selectedCategory, setSelectedCategory] = useState<string>("damaged_item");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Modern Custom Dropdown UI States & Refs
  const [orderDropdownOpen, setOrderDropdownOpen] = useState(false);
  const [itemDropdownOpen, setItemDropdownOpen] = useState(false);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);

  const orderDropdownRef = useRef<HTMLDivElement | null>(null);
  const itemDropdownRef = useRef<HTMLDivElement | null>(null);
  const categoryDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (orderDropdownRef.current && !orderDropdownRef.current.contains(e.target as Node)) {
        setOrderDropdownOpen(false);
      }
      if (itemDropdownRef.current && !itemDropdownRef.current.contains(e.target as Node)) {
        setItemDropdownOpen(false);
      }
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setCategoryDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  // Deep-linking from URL (?tab=new&orderId=...&itemId=...)
  useEffect(() => {
    if (urlTab === "new" || urlOrderId) {
      setActiveTab("new");
    }
    if (urlOrderId) {
      setSelectedOrderId(urlOrderId);
    }
    if (urlItemId) {
      setSelectedOrderItemId(urlItemId);
    }
  }, [urlTab, urlOrderId, urlItemId]);

  // Active Order & Items computed
  const activeOrder = useMemo(() => {
    return orders.find((o) => String(o.id) === String(selectedOrderId)) || null;
  }, [orders, selectedOrderId]);

  const activeOrderItems = useMemo(() => {
    if (!activeOrder || !Array.isArray(activeOrder.items)) return [];
    return activeOrder.items;
  }, [activeOrder]);

  const selectedOrderItem = useMemo(() => {
    if (!selectedOrderItemId || !activeOrderItems.length) return null;
    return (
      activeOrderItems.find(
        (it: any) =>
          String(it.id) === String(selectedOrderItemId) ||
          String(it.order_item_id) === String(selectedOrderItemId) ||
          String(it.product_id) === String(selectedOrderItemId)
      ) || null
    );
  }, [activeOrderItems, selectedOrderItemId]);

  // Auto-sync item & subject when orders data finishes loading from API
  useEffect(() => {
    if (!orders.length || !urlOrderId) return;
    const matchedOrder = orders.find((o) => String(o.id) === String(urlOrderId));
    if (matchedOrder) {
      setSelectedOrderId(matchedOrder.id);
      if (urlItemId && Array.isArray(matchedOrder.items)) {
        const matchedItem = matchedOrder.items.find(
          (it: any) =>
            String(it.id) === String(urlItemId) ||
            String(it.order_item_id) === String(urlItemId) ||
            String(it.product_id) === String(urlItemId)
        );
        if (matchedItem) {
          setSelectedOrderItemId(String(matchedItem.id || matchedItem.order_item_id || matchedItem.product_id));
          const variantText = matchedItem.variant_title || matchedItem.selected_variant_value ? ` (${matchedItem.variant_title || matchedItem.selected_variant_value})` : "";
          setSubject(`Issue with ${matchedItem.product_name}${variantText} - Order #${matchedOrder.id.slice(0, 8)}`);
        } else {
          setSubject(`Order #${matchedOrder.id.slice(0, 8)} Inquiry`);
        }
      } else {
        setSubject(`Order #${matchedOrder.id.slice(0, 8)} Inquiry`);
      }
    }
  }, [orders, urlOrderId, urlItemId]);

  const handleOrderSelect = (orderId: string) => {
    setSelectedOrderId(orderId);
    setSelectedOrderItemId("");
    if (!orderId) {
      setSubject("General Customer Support Inquiry");
      return;
    }
    const ord = orders.find((o) => String(o.id) === String(orderId));
    if (ord) {
      const prefix = `Order #${ord.id.slice(0, 8)}`;
      if (!subject || subject.startsWith("Order #") || subject.startsWith("Support Request") || subject.startsWith("Issue with")) {
        setSubject(`${prefix} Inquiry`);
      }
    }
  };

  const handleOrderItemSelect = (itemId: string) => {
    setSelectedOrderItemId(itemId);
    if (itemId && activeOrderItems.length) {
      const item = activeOrderItems.find(
        (it: any) =>
          String(it.id) === String(itemId) ||
          String(it.order_item_id) === String(itemId) ||
          String(it.product_id) === String(itemId)
      );
      if (item) {
        const variantText = item.variant_title || item.selected_variant_value ? ` (${item.variant_title || item.selected_variant_value})` : "";
        const orderPart = selectedOrderId ? ` - Order #${selectedOrderId.slice(0, 8)}` : "";
        setSubject(`Issue with ${item.product_name}${variantText}${orderPart}`);
      }
    } else if (selectedOrderId) {
      setSubject(`Order #${selectedOrderId.slice(0, 8)} Inquiry`);
    }
  };

  // Load tickets and initial page of orders on mount / site change
  useEffect(() => {
    const targetId = siteData?.site_id || siteData?.id || effectiveSiteId;
    if (targetId) {
      // Clear stale data from any previous site immediately before fetching
      setOrders([]);
      setOrdersPage(1);
      setOrdersTotalPages(1);
      setOrdersTotalCount(0);
      ordersLRUCache.current.clear();

      setTickets([]);
      setTicketsPage(1);
      setTicketsTotalPages(1);
      setTicketsTotalCount(0);
      ticketsLRUCache.current.clear();
      ticketMessagesLRUCache.current.clear();

      loadTickets(1, false);
      loadOrders(1, false);
    }
  }, [effectiveSiteId, siteData?.site_id, siteData?.id]);

  // Server-side paginated load of tickets (8 items per batch) with LRU caching
  const loadTickets = async (targetPage = 1, isAppend = false, isSilent = false) => {
    const targetSiteId = siteData?.site_id || siteData?.id || effectiveSiteId;
    if (!targetSiteId) return;

    if (isAppend) {
      setTicketsLoadingMore(true);
    } else if (!isSilent) {
      setTicketsLoading(true);
    }

    const cacheKey = `${targetSiteId}_tickets_page_${targetPage}_ps8`;
    const cachedData = ticketsLRUCache.current.get(cacheKey);

    if (cachedData) {
      if (isAppend) {
        setTickets((prev) => {
          const existingIds = new Set(prev.map((t) => String(t.id)));
          const filtered = (cachedData.tickets || []).filter((t: any) => !existingIds.has(String(t.id)));
          return [...prev, ...filtered].slice(0, 40);
        });
      } else {
        const list = (cachedData.tickets || []).slice(0, 40);
        setTickets(list);
        if (!selectedTicketId && list.length > 0 && !isMobile) {
          setSelectedTicketId(list[0].id);
        }
      }
      setTicketsPage(targetPage);
      setTicketsTotalPages(cachedData.total_pages || 1);
      setTicketsTotalCount(cachedData.total || (cachedData.tickets || []).length);
      if (!isSilent) setTicketsLoading(false);
      setTicketsLoadingMore(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/sites/${targetSiteId}/support/tickets/my?page=${targetPage}&page_size=8`, {
        credentials: "include",
        headers: getCustomerAuthHeaders(targetSiteId),
      });
      if (res.ok) {
        const data = await res.json();
        const incomingTickets: any[] = Array.isArray(data.tickets)
          ? data.tickets
          : Array.isArray(data)
            ? data
            : [];
        const total = typeof data.total === "number" ? data.total : incomingTickets.length;
        const totalPages = typeof data.total_pages === "number" ? data.total_pages : 1;

        ticketsLRUCache.current.set(cacheKey, {
          tickets: incomingTickets,
          total,
          total_pages: totalPages,
        });

        if (isAppend) {
          setTickets((prev) => {
            const existingIds = new Set(prev.map((t) => String(t.id)));
            const filtered = incomingTickets.filter((t: any) => !existingIds.has(String(t.id)));
            return [...prev, ...filtered].slice(0, 40);
          });
        } else {
          const list = incomingTickets.slice(0, 40);
          setTickets(list);
          if (!selectedTicketId && list.length > 0 && !isMobile) {
            setSelectedTicketId(list[0].id);
          }
        }
        setTicketsPage(targetPage);
        setTicketsTotalPages(totalPages);
        setTicketsTotalCount(total);
      } else if (effectiveSiteId && effectiveSiteId !== targetSiteId) {
        const res2 = await fetch(`${API_BASE_URL}/sites/${effectiveSiteId}/support/tickets/my?page=${targetPage}&page_size=8`, {
          credentials: "include",
          headers: getCustomerAuthHeaders(effectiveSiteId),
        });
        if (res2.ok) {
          const data2 = await res2.json();
          const incoming2 = Array.isArray(data2.tickets) ? data2.tickets : [];
          const total2 = typeof data2.total === "number" ? data2.total : incoming2.length;
          const totalPages2 = typeof data2.total_pages === "number" ? data2.total_pages : 1;

          ticketsLRUCache.current.set(cacheKey, {
            tickets: incoming2,
            total: total2,
            total_pages: totalPages2,
          });

          if (isAppend) {
            setTickets((prev) => {
              const existingIds = new Set(prev.map((t) => String(t.id)));
              const filtered = incoming2.filter((t: any) => !existingIds.has(String(t.id)));
              return [...prev, ...filtered].slice(0, 40);
            });
          } else {
            const list2 = incoming2.slice(0, 40);
            setTickets(list2);
            if (!selectedTicketId && list2.length > 0 && !isMobile) {
              setSelectedTicketId(list2[0].id);
            }
          }
          setTicketsPage(targetPage);
          setTicketsTotalPages(totalPages2);
          setTicketsTotalCount(total2);
        }
      }
    } catch {
      // silent
    } finally {
      if (!isSilent) setTicketsLoading(false);
      setTicketsLoadingMore(false);
    }
  };

  const handleTicketsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (
      scrollTop + clientHeight >= scrollHeight - 30 &&
      !ticketsLoading &&
      !ticketsLoadingMore &&
      ticketsPage < ticketsTotalPages
    ) {
      loadTickets(ticketsPage + 1, true);
    }
  };

  const ticketsBottomSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ticketsBottomSentinelRef.current || ticketsPage >= ticketsTotalPages || ticketsLoading || ticketsLoadingMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && ticketsPage < ticketsTotalPages && !ticketsLoading && !ticketsLoadingMore) {
          loadTickets(ticketsPage + 1, true);
        }
      },
      { threshold: 0.1, rootMargin: "120px" }
    );

    const el = ticketsBottomSentinelRef.current;
    observer.observe(el);
    return () => observer.disconnect();
  }, [ticketsPage, ticketsTotalPages, ticketsLoading, ticketsLoadingMore]);

  // Server-side paginated load of orders (6 items per batch) with LRU caching
  const loadOrders = async (targetPage = 1, isAppend = false) => {
    const targetSiteId = siteData?.site_id || siteData?.id || effectiveSiteId;
    if (!targetSiteId) return;

    if (isAppend) {
      setOrdersLoadingMore(true);
    } else {
      setOrdersLoading(true);
    }

    const cacheKey = `${targetSiteId}_page_${targetPage}_ps6`;
    const cachedData = ordersLRUCache.current.get(cacheKey);

    if (cachedData) {
      if (isAppend) {
        setOrders((prev) => {
          const existingIds = new Set(prev.map((o) => String(o.id)));
          const filtered = (cachedData.orders || []).filter((o: any) => !existingIds.has(String(o.id)));
          // Hard cap: keep at most 30 orders in state at any time
          return [...prev, ...filtered].slice(0, 30);
        });
      } else {
        setOrders((cachedData.orders || []).slice(0, 30));
      }
      setOrdersPage(targetPage);
      setOrdersTotalPages(cachedData.total_pages || 1);
      setOrdersTotalCount(cachedData.total || (cachedData.orders || []).length);
      setOrdersLoading(false);
      setOrdersLoadingMore(false);
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE_URL}/orders/${targetSiteId}/my-orders?page=${targetPage}&page_size=6`,
        {
          credentials: "include",
          headers: getCustomerAuthHeaders(targetSiteId),
        }
      );

      if (res.ok) {
        const data = await res.json();
        const incomingOrders: any[] = Array.isArray(data)
          ? data
          : data && Array.isArray(data.orders)
            ? data.orders
            : [];
        const total = typeof data.total === "number" ? data.total : incomingOrders.length;
        const totalPages = typeof data.total_pages === "number" ? data.total_pages : 1;

        ordersLRUCache.current.set(cacheKey, {
          orders: incomingOrders,
          total,
          total_pages: totalPages,
        });

        if (isAppend) {
          setOrders((prev) => {
            const existingIds = new Set(prev.map((o) => String(o.id)));
            const filtered = incomingOrders.filter((o: any) => !existingIds.has(String(o.id)));
            // Hard cap: keep at most 30 orders in state at any time
            return [...prev, ...filtered].slice(0, 30);
          });
        } else {
          setOrders(incomingOrders.slice(0, 30));
        }

        setOrdersPage(targetPage);
        setOrdersTotalPages(totalPages);
        setOrdersTotalCount(total);
      }
    } catch {
      // silent
    } finally {
      setOrdersLoading(false);
      setOrdersLoadingMore(false);
    }
  };

  const handleOrderDropdownScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (
      scrollTop + clientHeight >= scrollHeight - 35 &&
      !ordersLoading &&
      !ordersLoadingMore &&
      ordersPage < ordersTotalPages
    ) {
      loadOrders(ordersPage + 1, true);
    }
  };

  // Paginated chat messages (20 messages per batch) with scroll-to-top older message loading
  const loadTicketDetail = async (ticketId: string, page = 1, isOlder = false, isSilent = false) => {
    if (!effectiveSiteId || !ticketId) return;
    if (isOlder) {
      setMessagesLoadingOlder(true);
    } else if (!isSilent) {
      setChatLoading(true);
    }

    const prevScrollHeight = chatContainerRef.current?.scrollHeight || 0;

    try {
      const res = await fetch(
        `${API_BASE_URL}/sites/${effectiveSiteId}/support/tickets/${ticketId}?page=${page}&page_size=20`,
        {
          credentials: "include",
          headers: getCustomerAuthHeaders(effectiveSiteId),
        }
      );
      if (res.ok) {
        const data = await res.json();
        setTicketDetail((prev: any) => {
          if (
            prev &&
            prev.id === data.ticket?.id &&
            prev.status === data.ticket?.status &&
            prev.resolution_note === data.ticket?.resolution_note &&
            prev.resolved_at === data.ticket?.resolved_at
          ) {
            return prev;
          }
          return data.ticket;
        });

        const incoming: any[] = Array.isArray(data.messages) ? data.messages : [];
        const pagination = data.pagination || {};
        const totalPages = typeof pagination.total_pages === "number" ? pagination.total_pages : 1;
        const total = typeof pagination.total === "number" ? pagination.total : incoming.length;
        const hasOlder = pagination.has_more_older ?? (page < totalPages);

        if (isOlder) {
          // Prepend older messages while maintaining scroll position
          setMessages((prev: any[]) => {
            const existingIds = new Set(prev.map((m) => String(m.id || m.created_at)));
            const filteredIncoming = incoming.filter((m: any) => !existingIds.has(String(m.id || m.created_at)));
            const combined = [...filteredIncoming, ...prev];
            combined.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
            return combined.slice(-150);
          });
          setMessagesPage(page);
          setHasMoreOlderMessages(hasOlder);

          // Preserve exact scroll position so chat does not jump
          requestAnimationFrame(() => {
            if (chatContainerRef.current) {
              const newScrollHeight = chatContainerRef.current.scrollHeight;
              chatContainerRef.current.scrollTop = newScrollHeight - prevScrollHeight;
            }
          });
        } else if (isSilent) {
          // Background poll (every 5s): MERGE incoming into prev without discarding older messages!
          setMessages((prev: any[]) => {
            if (prev.length === 0) return incoming.slice(-150);

            const norm = (s: string) => (s || "").replace(/\r\n/g, "\n").trim();

            // 1. Build a map of incoming messages by ID so we can update read receipts/fields in-place
            const incomingMap = new Map<string, any>();
            for (const inc of incoming) {
              if (inc.id) {
                incomingMap.set(String(inc.id), inc);
              }
            }

            // 2. Update existing messages without losing older messages in prev
            const updatedPrev = prev.map((m) => {
              const inc = incomingMap.get(String(m.id));
              if (inc) {
                return { ...m, ...inc };
              }
              return m;
            });

            // 3. Find any completely new messages from incoming not yet in prev
            const existingIds = new Set(prev.map((m) => String(m.id || "")));
            const newIncoming = incoming.filter((inc) => !existingIds.has(String(inc.id || "")));

            // 4. Remove active temporary messages confirmed by incoming
            const filteredPrev = updatedPrev.filter((m) => {
              if (String(m.id || "").startsWith("temp_")) {
                const confirmed = incoming.some(
                  (inc) => inc.sender_type === m.sender_type && norm(inc.message) === norm(m.message)
                );
                return !confirmed;
              }
              return true;
            });

            const combined = [...filteredPrev, ...newIncoming];
            // Sort chronologically
            combined.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

            // Strict ID and content deduplication
            const seen = new Set<string>();
            const deduplicated: any[] = [];
            for (const m of combined) {
              const key = String(m.id || m.created_at || "");
              if (key && !seen.has(key)) {
                seen.add(key);
                deduplicated.push(m);
              } else if (!key) {
                deduplicated.push(m);
              }
            }

            // Auto-scroll if user is close to bottom and there is a new message
            if (newIncoming.length > 0 && chatContainerRef.current) {
              const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
              if (scrollHeight - scrollTop - clientHeight < 150) {
                requestAnimationFrame(() => {
                  if (chatContainerRef.current) {
                    chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
                  }
                });
              }
            }
            return deduplicated.slice(-150);
          });
        } else {
          // First open of ticket thread: load page 1 and scroll to bottom
          setMessages(incoming.slice(-150));
          setMessagesPage(1);
          setMessagesTotalPages(totalPages);
          setMessagesTotalCount(total);
          setHasMoreOlderMessages(hasOlder);

          requestAnimationFrame(() => {
            if (chatContainerRef.current) {
              chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
            }
          });
        }
      }
    } catch {
      // silent
    } finally {
      if (isOlder) {
        setMessagesLoadingOlder(false);
      } else if (!isSilent) {
        setChatLoading(false);
      }
    }
  };

  const handleChatScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop } = e.currentTarget;
    if (
      scrollTop <= 30 &&
      !chatLoading &&
      !messagesLoadingOlder &&
      hasMoreOlderMessages &&
      selectedTicketId
    ) {
      loadTicketDetail(selectedTicketId, messagesPage + 1, true, false);
    }
  };

  // Real-time Instant Live Sync via Server-Sent Events (SSE) & read receipt updates
  useEffect(() => {
    if (activeTab !== "inquiries" || !selectedTicketId || !effectiveSiteId) return;
    loadTicketDetail(selectedTicketId, 1, false, false);

    // Open real-time sub-millisecond SSE stream for instant delivery and WhatsApp seen receipt updates
    const sseUrl = `${API_BASE_URL}/sites/${effectiveSiteId}/support/tickets/${selectedTicketId}/stream`;
    let es: EventSource | null = null;
    try {
      es = new EventSource(sseUrl, { withCredentials: true });
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "new_message" && data.message) {
            setMessages((prev) => {
              const msgId = String(data.message.id);
              const norm = (s: string) => (s || "").replace(/\r\n/g, "\n").trim();
              const withoutTemp = prev.filter(
                (m) => !(String(m.id || "").startsWith("temp_") && norm(m.message) === norm(data.message.message))
              );
              if (withoutTemp.some((m) => String(m.id) === msgId)) {
                return withoutTemp;
              }
              return [...withoutTemp, data.message].slice(-60);
            });
            requestAnimationFrame(() => {
              if (chatContainerRef.current) {
                chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
              }
            });
          } else if (data.type === "messages_read") {
            // Support specialist/admin read customer message -> turn double ticks blue!
            setMessages((prev) =>
              prev.map((m) =>
                m.sender_type === "customer" && !m.read_at
                  ? { ...m, read_at: data.read_at || new Date().toISOString() }
                  : m
              )
            );
          }
        } catch { }
      };
    } catch { }

    // Fallback timer (5s) for background ticket status sync
    const liveTimer = setInterval(() => {
      if (document.hidden) return;
      loadTicketDetail(selectedTicketId, 1, false, true);
    }, 5000);

    return () => {
      if (es) es.close();
      clearInterval(liveTimer);
    };
  }, [selectedTicketId, activeTab, effectiveSiteId]);

  // Scroll chat messages container down when changing tickets or opening chat
  const lastTicketIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!chatContainerRef.current) return;
    if (selectedTicketId !== lastTicketIdRef.current || chatOpen) {
      lastTicketIdRef.current = selectedTicketId;
      requestAnimationFrame(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
      });
    }
  }, [selectedTicketId, chatOpen]);

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sendingReply) return;
    const trimmed = replyText.trim();
    if ((!trimmed && !chatImage) || !selectedTicketId || !effectiveSiteId) return;

    // Immediately keep input focused synchronously so mobile keyboard never closes
    if (chatInputRef.current) {
      chatInputRef.current.focus();
    }

    setSendingReply(true);
    const tempId = `temp_${Date.now()}`;
    const previousReply = replyText;
    const currentChatImage = chatImage;

    // Optimistically show message immediately so the UI is responsive with zero lag and zero refresh
    const optimisticAttachments = currentChatImage ? [currentChatImage.previewUrl] : [];
    const optimisticMsg = {
      id: tempId,
      sender_type: "customer",
      sender_name: "You",
      message: trimmed || (optimisticAttachments.length > 0 ? "Attached photo" : ""),
      attachments: optimisticAttachments,
      created_at: new Date().toISOString(),
    };

    setMessages((prev: any[]) => [...prev, optimisticMsg].slice(-60));
    setReplyText("");
    setChatImage(null);

    // Keep keyboard open and re-focus input immediately (like WhatsApp/iMessage)
    requestAnimationFrame(() => {
      if (chatInputRef.current) {
        chatInputRef.current.focus();
      }
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    });

    try {
      let attachmentUrls: string[] = [];
      if (currentChatImage) {
        setUploadingChatImage(true);
        const uploadedUrl = await uploadFileToSupport(currentChatImage.file);
        attachmentUrls.push(uploadedUrl);
      }

      const res = await fetch(
        `${API_BASE_URL}/sites/${effectiveSiteId}/support/tickets/${selectedTicketId}/messages`,
        {
          method: "POST",
          headers: getCustomerAuthHeaders(effectiveSiteId, { "Content-Type": "application/json" }),
          credentials: "include",
          body: JSON.stringify({
            message: trimmed || (attachmentUrls.length > 0 ? "Attached photo" : ""),
            attachments: attachmentUrls,
          }),
        }
      );
      if (res.ok) {
        const resData = await res.json().catch(() => null);
        if (currentChatImage) {
          URL.revokeObjectURL(currentChatImage.previewUrl);
        }
        // Instantly swap optimistic temp message with confirmed server message in-place
        if (resData?.message) {
          setMessages((prev) => {
            const withoutTemp = prev.filter((m) => m.id !== tempId);
            if (withoutTemp.some((m) => m.id === resData.message.id)) {
              return withoutTemp;
            }
            return [...withoutTemp, resData.message].slice(-60);
          });
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
        }

        ticketsLRUCache.current.clear();
        await loadTicketDetail(selectedTicketId, 1, false, true);
        await loadTickets(1, false, true);
      } else {
        // Rollback optimistic update
        setMessages((prev: any[]) => prev.filter((m: any) => m.id !== tempId));
        setReplyText(previousReply);
        setChatImage(currentChatImage);
        const err = await res.json().catch(() => null);
        alert(err?.detail || "Failed to send message.");
      }
    } catch (err: any) {
      // Rollback optimistic update
      setMessages((prev: any[]) => prev.filter((m: any) => m.id !== tempId));
      setReplyText(previousReply);
      setChatImage(currentChatImage);
      alert(err.message || "Failed to send message.");
    } finally {
      setSendingReply(false);
      setUploadingChatImage(false);
    }
  };

  const handleCloseTicket = async () => {
    if (!selectedTicketId || !effectiveSiteId) return;
    if (!window.confirm("Are you sure you want to end this chat?")) return;

    setClosingTicket(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/sites/${effectiveSiteId}/support/tickets/${selectedTicketId}/close`,
        {
          method: "POST",
          headers: getCustomerAuthHeaders(effectiveSiteId, { "Content-Type": "application/json" }),
          credentials: "include",
        }
      );
      if (res.ok) {
        setToastMessage("Chat ended.");
        setTimeout(() => setToastMessage(null), 3000);
        ticketsLRUCache.current.clear();
        await loadTicketDetail(selectedTicketId, 1, false, true);
        await loadTickets(1, false, true);
      }
    } catch {
      // silent
    } finally {
      setClosingTicket(false);
    }
  };

  const handleSubmitNewRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!message.trim()) {
      setSubmitError("Please describe your issue.");
      return;
    }

    const categoryObj = CATEGORIES.find((c) => c.id === selectedCategory);
    const finalSubject =
      subject.trim() ||
      `${categoryObj?.label || "Support Request"}${selectedOrderItem
        ? ` - ${selectedOrderItem.product_name}`
        : selectedOrderId
          ? ` (Order #${selectedOrderId.slice(0, 8)})`
          : ""
      }`;

    const orderItemsSummary = selectedOrderItem
      ? {
        product_id: selectedOrderItem.product_id,
        product_name: selectedOrderItem.product_name,
        variant_title: selectedOrderItem.variant_title || null,
        quantity: selectedOrderItem.quantity || 1,
        price: selectedOrderItem.unit_price || selectedOrderItem.line_total || 0,
        image_url: selectedOrderItem.product_image || selectedOrderItem.image_url || null,
      }
      : null;

    setSubmitting(true);
    try {
      let attachments: string[] = [];
      if (newRequestImage) {
        setUploadingNewRequestImage(true);
        const uploadedUrl = await uploadFileToSupport(newRequestImage.file);
        attachments.push(uploadedUrl);
      }

      if (message.trim().length < 5) {
        throw new Error("Please provide more details in your message (at least 5 characters).");
      }

      const payload: any = {
        order_id: selectedOrderId || null,
        category: selectedCategory,
        priority: "medium",
        subject: finalSubject,
        message: message.trim(),
        attachments,
        order_items_summary: orderItemsSummary,
      };

      const res = await fetch(`${API_BASE_URL}/sites/${effectiveSiteId}/support/tickets`, {
        method: "POST",
        headers: getCustomerAuthHeaders(effectiveSiteId, { "Content-Type": "application/json" }),
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(parseApiError(data, "Failed to submit support request"));
      }

      setSubject("");
      setMessage("");
      if (newRequestImage) {
        URL.revokeObjectURL(newRequestImage.previewUrl);
        setNewRequestImage(null);
      }
      setSelectedOrderId("");
      setSelectedOrderItemId("");
      setToastMessage(`Request #${data.ticket.ticket_number} created successfully.`);
      setTimeout(() => setToastMessage(null), 3500);

      ticketsLRUCache.current.clear();
      await loadTickets(1, false);
      setSelectedTicketId(data.ticket.id);
      setChatOpen(true);
      setActiveTab("inquiries");
    } catch (err: any) {
      setSubmitError(err.message || "Failed to submit request.");
    } finally {
      setSubmitting(false);
      setUploadingNewRequestImage(false);
    }
  };

  return (
    <div
      style={{
        ...(isDesktopAdmin
          ? {
            height: "auto",
            minHeight: "auto",
            maxHeight: "none",
            display: "flex",
            flexDirection: "column",
            flex: "none",
            padding: "10px 18px 20px",
            overflow: "visible",
          }
          : isMobile && chatOpen
            ? {
              position: !isAdmin ? "fixed" : "relative",
              top: !isAdmin
                ? (isKeyboardActive ? (viewportOffsetTop > 0 ? `${viewportOffsetTop}px` : "0px") : `${navbarHeight}px`)
                : undefined,
              left: 0,
              right: 0,
              bottom: !isAdmin ? (isKeyboardActive ? undefined : 0) : undefined,
              height: !isAdmin
                ? (isKeyboardActive ? `${viewportHeight || (typeof window !== "undefined" ? window.visualViewport?.height || window.innerHeight : 600)}px` : `calc(100dvh - ${navbarHeight}px)`)
                : `${adminPhoneHeight}px`,
              minHeight: !isAdmin ? "0px" : `${adminPhoneHeight}px`,
              maxHeight: !isAdmin
                ? (isKeyboardActive ? `${viewportHeight || (typeof window !== "undefined" ? window.visualViewport?.height || window.innerHeight : 600)}px` : `calc(100dvh - ${navbarHeight}px)`)
                : `${adminPhoneHeight}px`,
              zIndex: !isAdmin ? 9990 : 1,
              padding: isKeyboardActive ? "0px" : "6px 8px 8px",
              display: "flex",
              flexDirection: "column",
              flex: "1 1 0%",
              overflow: "hidden",
            }
            : isMobile
              ? {
                height: "auto",
                minHeight: isAdmin ? `${adminPhoneHeight}px` : (viewportHeight ? `${Math.max(360, viewportHeight - navbarHeight)}px` : `calc(100dvh - ${navbarHeight}px)`),
                maxHeight: "none",
                padding: effectiveViewportWidth > 640 ? "8px 16px 10px" : "6px 8px 8px",
                display: "flex",
                flexDirection: "column",
                flex: "none",
                overflow: "visible",
              }
              : {
                height: `calc(100vh - ${navbarHeight}px)`,
                minHeight: `calc(100vh - ${navbarHeight}px)`,
                maxHeight: `calc(100vh - ${navbarHeight}px)`,
                padding: "8px 16px 10px",
                display: "flex",
                flexDirection: "column",
                flex: "1 1 0%",
                overflow: "hidden",
              }),
        background: primaryBg,
        color: textColor,
        boxSizing: "border-box",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: (!isAdmin && !isMobile) || (isMobile && chatOpen) ? "hidden" : "visible",
        touchAction: !isAdmin && isMobile && chatOpen ? "none" : undefined,
        overscrollBehavior: isMobile && chatOpen ? "none" : "auto",
        flex: (!isAdmin && !isMobile) || (isMobile && chatOpen) ? "1 1 0%" : "none",
      }}
    >
      <style>{`
        @keyframes pulseLiveDot {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 6px rgba(34, 197, 94, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(34, 197, 94, 0);
          }
        }
        @keyframes messageSlideIn {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes dropdownFadeIn {
          0% {
            opacity: 0;
            transform: translateY(-6px) scale(0.99);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .custom-chat-scroll {
          overflow-y: auto !important;
          -webkit-overflow-scrolling: touch !important;
          touch-action: pan-y !important;
          overscroll-behavior: contain !important;
          scrollbar-width: thin !important;
        }
        .custom-chat-scroll::-webkit-scrollbar {
          width: 5px;
        }
        .custom-chat-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-chat-scroll::-webkit-scrollbar-thumb {
          background: rgba(140, 140, 140, 0.2);
          border-radius: 999px;
        }
        .custom-chat-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(140, 140, 140, 0.4);
        }
      `}</style>
      <div
        style={{
          width: "100%",
          maxWidth: resolvedMaxWidth,
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: isMobile ? "6px" : "8px",
          flex: (!isAdmin && !isMobile) || (isMobile && chatOpen) ? "1 1 0%" : "none",
          minHeight: 0,
          height: (!isAdmin && !isMobile) || (isMobile && chatOpen) ? "100%" : "auto",
          maxHeight: (!isAdmin && !isMobile) || (isMobile && chatOpen) ? "100%" : "none",
          overflow: (!isAdmin && !isMobile) || (isMobile && chatOpen) ? "hidden" : "visible",
        }}
      >
        {/* Toast Notification */}
        {toastMessage && (
          <div
            style={{
              position: "fixed",
              top: "24px",
              right: "24px",
              zIndex: 9999,
              padding: "10px 16px",
              borderRadius: buttonRadius,
              background: "#16a34a",
              color: "#ffffff",
              fontSize: "13px",
              fontWeight: 600,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
              maxWidth: "380px",
              animation: "dropdownFadeIn 0.2s ease",
            }}
          >
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0, display: "grid", placeItems: "center" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* When CRM is disabled */}
        {!isCrmEnabled ? (
          <div
            style={{
              background: cardBg,
              borderRadius: cardRadius,
              border: `1px solid ${borderColor}`,
              padding: isMobile ? "40px 20px" : "64px 32px",
              textAlign: "center",
              color: textColor,
              marginTop: "20px",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "rgba(239, 68, 68, 0.1)",
                color: "#ef4444",
                display: "grid",
                placeItems: "center",
                margin: "0 auto 16px auto",
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 style={{ fontSize: "20px", fontWeight: 800, margin: "0 0 8px 0" }}>Customer Support Unavailable</h2>
            <p style={{ color: textMuted, fontSize: "14px", maxWidth: "460px", margin: "0 auto 24px auto", lineHeight: 1.5 }}>
              Customer care and CRM services are currently paused for this store. Please check back later or continue exploring our catalog.
            </p>
            <button
              type="button"
              onClick={() => {
                const homeTarget = activeSlug ? `/store/${activeSlug}` : "/";
                navigate(homeTarget);
              }}
              style={{
                padding: "10px 24px",
                borderRadius: buttonRadius,
                border: "none",
                background: accentColor,
                color: buttonTextColor,
                fontSize: "13.5px",
                fontWeight: 700,
                cursor: "pointer",
                transition: "opacity 0.15s ease",
              }}
            >
              ← Back to Store
            </button>
          </div>
        ) : (
          <>
            {/* Top Navigation & Breadcrumb Header Bar (Hidden on Mobile if Chat Thread is Open) */}
            {(!isMobile || !chatOpen) && (
              <div
                style={{
                  display: "flex",
                  flexDirection: isMobile ? (effectiveViewportWidth > 640 ? "row" : "column") : "row",
                  justifyContent: "space-between",
                  alignItems: isMobile ? (effectiveViewportWidth > 640 ? "center" : "stretch") : "center",
                  gap: isMobile ? "8px" : "12px",
                  padding: "0 2px",
                  width: "100%",
                  flexShrink: 0,
                }}
              >
                {/* Breadcrumb */}
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12.5px",
                    color: textMuted,
                    fontWeight: 600,
                  }}
                >
                  <span
                    onClick={() => {
                      const path = window.location.pathname;
                      if (path.startsWith("/builder/")) {
                        const segments = path.split("/").filter(Boolean);
                        const currentSiteId = segments[1] || effectiveSiteId;
                        navigate(`/builder/${currentSiteId}`);
                      } else if (activeSlug) {
                        navigate(`/store/${activeSlug}`);
                      } else if (effectiveSiteId) {
                        navigate(`/builder/${effectiveSiteId}`);
                      } else {
                        navigate("/");
                      }
                    }}
                    style={{
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      color: textMuted,
                      transition: "color 0.15s ease",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = accentColor)}
                    onMouseLeave={(e) => (e.currentTarget.style.color = textMuted)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="19" y1="12" x2="5" y2="12" />
                      <polyline points="12 19 5 12 12 5" />
                    </svg>
                    <span>Store</span>
                  </span>
                  <span>/</span>
                  <span style={{ color: titleColor, fontWeight: 700 }}>Customer Support Desk</span>
                </div>

                {!isMobile && showContactInfo && (supportEmail || siteContactEmail || supportPhone || siteContactPhone || supportHours) && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "11px", color: textMuted, flexWrap: "wrap" }}>
                    {(supportEmail || siteContactEmail) && (
                      <span>Email: <strong style={{ color: textColor }}>{supportEmail || siteContactEmail}</strong></span>
                    )}
                    {(supportPhone || siteContactPhone) && (
                      <span>{(supportEmail || siteContactEmail) ? "• " : ""}Phone: <strong style={{ color: textColor }}>{supportPhone || siteContactPhone}</strong></span>
                    )}
                    {supportHours && (
                      <span>{((supportEmail || siteContactEmail) || (supportPhone || siteContactPhone)) ? "• " : ""}Hours: <strong style={{ color: textColor }}>{supportHours}</strong></span>
                    )}
                  </div>
                )}

                {/* Segmented Tab Bar / Navigation Pills */}
                {isMobile ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      background: isLight ? "rgba(15,23,42,0.06)" : "rgba(255,255,255,0.08)",
                      padding: "3px",
                      borderRadius: "10px",
                      width: effectiveViewportWidth > 640 ? "340px" : "100%",
                      boxSizing: "border-box",
                      gap: "4px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab("inquiries");
                        setChatOpen(false);
                      }}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "8px",
                        border: "none",
                        background: activeTab === "inquiries" ? (isLight ? "#ffffff" : "#1e293b") : "transparent",
                        color: activeTab === "inquiries" ? (isLight ? "#0f172a" : "#f8fafc") : textMuted,
                        fontSize: "12.5px",
                        fontWeight: activeTab === "inquiries" ? 700 : 600,
                        cursor: "pointer",
                        boxShadow: activeTab === "inquiries" ? "0 1px 4px rgba(0,0,0,0.10)" : "none",
                        transition: "all 0.15s ease",
                        textAlign: "center",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                      }}
                    >
                      <span>{inquiriesTabLabel}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab("new");
                        setChatOpen(false);
                      }}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "8px",
                        border: "none",
                        background: activeTab === "new" ? (isLight ? "#ffffff" : "#1e293b") : "transparent",
                        color: activeTab === "new" ? (isLight ? "#0f172a" : "#f8fafc") : textMuted,
                        fontSize: "12.5px",
                        fontWeight: activeTab === "new" ? 700 : 600,
                        cursor: "pointer",
                        boxShadow: activeTab === "new" ? "0 1px 4px rgba(0,0,0,0.10)" : "none",
                        transition: "all 0.15s ease",
                        textAlign: "center",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                      }}
                    >
                      <span>{newRequestTabLabel.startsWith("+") ? newRequestTabLabel : `+ ${newRequestTabLabel}`}</span>
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab("inquiries");
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "7px 14px",
                        borderRadius: buttonRadius,
                        border: activeTab === "inquiries" ? `1.5px solid ${accentColor}` : `1px solid ${borderColor}`,
                        background: activeTab === "inquiries" ? `${accentColor}14` : cardBg,
                        color: activeTab === "inquiries" ? accentColor : textMuted,
                        fontSize: "12.5px",
                        fontWeight: activeTab === "inquiries" ? 700 : 600,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      <span>{inquiriesTabLabel}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab("new");
                        setChatOpen(false);
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        padding: "7px 14px",
                        borderRadius: buttonRadius,
                        border: activeTab === "new" ? `1.5px solid ${accentColor}` : `1px solid ${borderColor}`,
                        background: activeTab === "new" ? `${accentColor}14` : cardBg,
                        color: activeTab === "new" ? accentColor : textMuted,
                        fontSize: "12.5px",
                        fontWeight: activeTab === "new" ? 700 : 600,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      <span>{newRequestTabLabel.replace(/^\+\s*/, "")}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB 1: INQUIRIES & CHAT (Master-Detail Dual Pane on Desktop, Sliding Pane on Mobile) */}
            {activeTab === "inquiries" && (
              <div
                style={{
                  background: cardBg,
                  borderRadius: isMobile && chatOpen && isKeyboardActive ? "0px" : cardRadius,
                  border: isMobile && chatOpen && isKeyboardActive ? "none" : `1px solid ${borderColor}`,
                  padding: isMobile && chatOpen ? "0px" : cardPadding,
                  gap: isMobile ? "0px" : "10px",
                  boxSizing: "border-box",
                  width: "100%",
                  flex: (!isAdmin && !isMobile) || (isMobile && chatOpen) ? "1 1 0%" : "none",
                  minHeight: isDesktopAdmin ? "440px" : (!isMobile ? (!isAdmin ? "0px" : "540px") : 0),
                  height: isDesktopAdmin ? "480px" : (!isMobile ? (!isAdmin ? "100%" : "580px") : (chatOpen ? "100%" : "auto")),
                  maxHeight: isDesktopAdmin ? "none" : (!isMobile ? (!isAdmin ? "100%" : "700px") : (chatOpen ? "100%" : "none")),
                  display: "flex",
                  overflow: !isMobile ? "hidden" : (chatOpen ? "hidden" : "visible"),
                  boxShadow: isMobile ? "none" : "0 4px 20px rgba(0,0,0,0.03)",
                }}
              >
                {/* LEFT SIDEBAR: Requests List (Shown on Desktop, or on Mobile when chat is NOT open) */}
                {(!isMobile || !chatOpen) && (
                  <div
                    style={{
                      width: isMobile ? "100%" : "290px",
                      minWidth: isMobile ? "100%" : "270px",
                      maxWidth: isMobile ? "100%" : "310px",
                      border: isMobile ? "none" : `1px solid ${borderColor}`,
                      borderRadius: isMobile ? 0 : innerRadius,
                      display: "flex",
                      flexDirection: "column",
                      flexShrink: 0,
                      flex: isMobile ? (chatOpen ? "1 1 0%" : "none") : "0 0 290px",
                      height: "100%",
                      minHeight: 0,
                      maxHeight: isMobile ? (chatOpen ? "100%" : "none") : "100%",
                      background: cardBg,
                      overflow: isMobile ? (chatOpen ? "hidden" : "visible") : "hidden",
                    }}
                  >
                    {/* List Header & Search Filter */}
                    <div
                      style={{
                        padding: "8px 10px",
                        borderBottom: `1px solid ${borderColor}`,
                        background: isLight ? "rgba(15,23,42,0.02)" : "rgba(255,255,255,0.02)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        flexShrink: 0,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontSize: "12.5px", fontWeight: 800, color: titleColor }}>
                            Your Inquiries
                          </span>
                          {tickets.length > 0 && (
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: 700,
                                padding: "1px 5px",
                                borderRadius: "10px",
                                background: `${accentColor}18`,
                                color: accentColor,
                              }}
                            >
                              {ticketsTotalCount || tickets.length}
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab("new");
                            setChatOpen(false);
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: accentColor,
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: "pointer",
                            padding: "2px 5px",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "2px",
                            borderRadius: "4px",
                          }}
                        >
                          <span>+ New</span>
                        </button>
                      </div>

                      {/* Ticket Search Input */}
                      {tickets.length > 2 && (
                        <div style={{ position: "relative", width: "100%" }}>
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={textMuted}
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
                          >
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                          </svg>
                          <input
                            type="text"
                            placeholder="Filter by subject or #..."
                            value={ticketSearchQuery}
                            onChange={(e) => setTicketSearchQuery(e.target.value)}
                            onFocus={() => {
                              if (!isAdmin && typeof window !== "undefined") {
                                window.scrollTo({ top: 0, left: 0, behavior: "instant" });
                              }
                            }}
                            style={{
                              width: "100%",
                              padding: isMobile ? "6px 24px 6px 28px" : "5px 22px 5px 26px",
                              borderRadius: inputRadius,
                              border: `1px solid ${inputBorder}`,
                              background: inputBg,
                              color: inputTextColor,
                              fontSize: isMobile ? "16px" : "11.5px",
                              outline: "none",
                              boxSizing: "border-box",
                              minHeight: isMobile ? "32px" : undefined,
                            }}
                          />
                          {ticketSearchQuery && (
                            <button
                              type="button"
                              onClick={() => setTicketSearchQuery("")}
                              style={{
                                position: "absolute",
                                right: "6px",
                                top: "50%",
                                transform: "translateY(-50%)",
                                background: "none",
                                border: "none",
                                color: textMuted,
                                cursor: "pointer",
                                padding: 0,
                                fontSize: "13px",
                                display: "grid",
                                placeItems: "center",
                              }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Scrollable List of Ticket Cards */}
                    <div
                      onScroll={handleTicketsScroll}
                      className={isMobile && !chatOpen ? undefined : "custom-chat-scroll"}
                      style={{
                        flex: isMobile && !chatOpen ? "none" : 1,
                        minHeight: 0,
                        overflowY: isMobile && !chatOpen ? "visible" : "auto",
                        WebkitOverflowScrolling: "touch",
                        overscrollBehavior: "contain",
                        touchAction: "pan-y",
                        padding: "6px 8px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      {ticketsLoading && tickets.length === 0 ? (
                        <div style={{ padding: "30px 16px", textAlign: "center", fontSize: "12px", color: textMuted }}>
                          Loading requests...
                        </div>
                      ) : tickets.length === 0 ? (
                        <div style={{ padding: "30px 16px", textAlign: "center" }}>
                          <div
                            style={{
                              width: "36px",
                              height: "36px",
                              borderRadius: "50%",
                              background: `${accentColor}12`,
                              color: accentColor,
                              display: "grid",
                              placeItems: "center",
                              margin: "0 auto 8px auto",
                            }}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                          </div>
                          <div style={{ fontSize: "12.5px", fontWeight: 700, color: textColor, marginBottom: "3px" }}>
                            No support tickets
                          </div>
                          <p style={{ fontSize: "11.5px", color: textMuted, margin: "0 0 12px", lineHeight: 1.4 }}>
                            You have not opened any inquiries for this store yet.
                          </p>
                          <button
                            type="button"
                            onClick={() => setActiveTab("new")}
                            style={{
                              padding: "6px 14px",
                              borderRadius: buttonRadius,
                              border: "none",
                              background: accentColor,
                              color: buttonTextColor,
                              fontSize: "11.5px",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Open New Request
                          </button>
                        </div>
                      ) : (
                        (() => {
                          const q = ticketSearchQuery.toLowerCase().trim();
                          const displayList = q
                            ? tickets.filter(
                              (t) =>
                                String(t.ticket_number || "").toLowerCase().includes(q) ||
                                String(t.subject || "").toLowerCase().includes(q) ||
                                String(t.order_id || "").toLowerCase().includes(q) ||
                                String(t.category || "").toLowerCase().includes(q)
                            )
                            : tickets;

                          if (displayList.length === 0) {
                            return (
                              <div style={{ padding: "24px 12px", textAlign: "center", fontSize: "11.5px", color: textMuted }}>
                                No tickets match "{ticketSearchQuery}"
                              </div>
                            );
                          }

                          return displayList.map((t) => {
                            const isSelected = selectedTicketId === t.id;
                            const st = STATUS_CONFIG[t.status] || STATUS_CONFIG.open;
                            return (
                              <div
                                key={t.id}
                                onClick={() => {
                                  setSelectedTicketId(t.id);
                                  if (isMobile) {
                                    setChatOpen(true);
                                  }
                                }}
                                style={{
                                  padding: "7px 9px",
                                  borderRadius: innerRadius,
                                  cursor: "pointer",
                                  background: isSelected
                                    ? (isLight
                                      ? `${accentColor}12`
                                      : `${accentColor}22`)
                                    : (isLight
                                      ? (cardBg === "#ffffff" ? "#f8fafc" : cardBg)
                                      : "rgba(255,255,255,0.04)"),
                                  border: isSelected
                                    ? `1.5px solid ${accentColor}`
                                    : `1px solid ${borderColor}`,
                                  borderLeft: isSelected
                                    ? `3.5px solid ${accentColor}`
                                    : `1px solid ${borderColor}`,
                                  transition: "all 0.12s ease",
                                  boxShadow: isSelected ? `0 2px 6px ${accentColor}15` : "none",
                                }}
                                onMouseEnter={(e) => {
                                  if (!isSelected) {
                                    e.currentTarget.style.borderColor = `${accentColor}70`;
                                    e.currentTarget.style.background = isLight ? "rgba(15,23,42,0.03)" : "rgba(255,255,255,0.06)";
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (!isSelected) {
                                    e.currentTarget.style.borderColor = borderColor;
                                    e.currentTarget.style.background = isLight ? (cardBg === "#ffffff" ? "#f8fafc" : cardBg) : "rgba(255,255,255,0.03)";
                                  }
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
                                  <span style={{ fontSize: "10.5px", fontWeight: 800, color: isSelected ? accentColor : textColor, fontFamily: "monospace" }}>
                                    #{t.ticket_number}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: "8.5px",
                                      fontWeight: 700,
                                      padding: "1px 5px",
                                      borderRadius: badgeRadius,
                                      background: st.bg,
                                      color: st.text,
                                      border: `1px solid ${st.border}`,
                                    }}
                                  >
                                    {st.label}
                                  </span>
                                </div>

                                <div
                                  style={{
                                    fontSize: "11.5px",
                                    fontWeight: isSelected ? 700 : 600,
                                    color: textColor,
                                    marginBottom: "2px",
                                    lineHeight: 1.25,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {t.subject}
                                </div>

                                {allowOrderSelection && t.order_items_summary && (
                                  <div
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "3px",
                                      fontSize: "9.5px",
                                      fontWeight: 600,
                                      color: accentColor,
                                      background: `${accentColor}10`,
                                      border: `1px solid ${accentColor}25`,
                                      padding: "1px 5px",
                                      borderRadius: badgeRadius,
                                      marginBottom: "2px",
                                      maxWidth: "100%",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {t.order_items_summary.product_name}
                                    </span>
                                  </div>
                                )}

                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "9.5px", color: textMuted }}>
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                    {renderCategoryIcon(t.category, 10)}
                                    <span>{t.category ? t.category.replace(/_/g, " ") : "General"}</span>
                                  </span>
                                  <span>{t.created_at ? formatTicketDate(t.created_at) : ""}</span>
                                </div>
                              </div>
                            );
                          });
                        })()
                      )}

                      {ticketsLoadingMore && (
                        <div style={{ padding: "8px", textAlign: "center", fontSize: "11px", color: accentColor, fontWeight: 600 }}>
                          Loading earlier inquiries...
                        </div>
                      )}

                      {ticketsPage < ticketsTotalPages && tickets.length > 0 && (
                        <button
                          type="button"
                          disabled={ticketsLoadingMore}
                          onClick={() => loadTickets(ticketsPage + 1, true)}
                          style={{
                            padding: "7px 12px",
                            margin: "6px 4px 4px",
                            borderRadius: buttonRadius,
                            border: `1px solid ${borderColor}`,
                            background: isLight ? "rgba(15,23,42,0.04)" : "rgba(255,255,255,0.06)",
                            color: accentColor,
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: ticketsLoadingMore ? "default" : "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "5px",
                            transition: "all 0.15s ease",
                            opacity: ticketsLoadingMore ? 0.6 : 1,
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <polyline points="19 12 12 19 5 12" />
                          </svg>
                          <span>{ticketsLoadingMore ? "Loading..." : `Load older inquiries (${Math.max(0, (ticketsTotalCount || 0) - tickets.length)} remaining)`}</span>
                        </button>
                      )}

                      {/* Sentinel element to auto-load older tickets on scroll */}
                      <div ref={ticketsBottomSentinelRef} style={{ height: "1px", width: "100%", pointerEvents: "none" }} />
                    </div>
                  </div>
                )}

                {/* RIGHT PANE: Active Chat Conversation Thread (Shown on Desktop always, on Mobile when chatOpen) */}
                {(!isMobile || chatOpen) && (
                  <div
                    style={{
                      flex: "1 1 0%",
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      background: chatBg,
                      borderRadius: isMobile ? 0 : chatRadius,
                      border: isMobile ? "none" : `1px solid ${borderColor}`,
                      overflow: "hidden",
                      height: "100%",
                      minHeight: 0,
                      maxHeight: "100%",
                    }}
                  >
                    {selectedTicketId && ticketDetail ? (
                      <>
                        {/* Clean, Modern Chat Header Bar (Organized & Uncluttered on Mobile & Desktop) */}
                        <div
                          style={{
                            padding: isMobile ? "6px 10px" : "6px 14px",
                            background: cardBg,
                            borderBottom: `1px solid ${borderColor}`,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "8px",
                            zIndex: 10,
                            boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                            flexShrink: 0,
                            minHeight: isMobile ? "44px" : "46px",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "8px" : "10px", minWidth: 0, flex: 1 }}>
                            {/* Clean Back Arrow Button (Mobile Only, Just Arrow Icon, No Text) */}
                            {isMobile && (
                              <button
                                type="button"
                                onClick={() => {
                                  handleDismissKeyboard();
                                  setChatOpen(false);
                                }}
                                style={{
                                  background: isLight ? "rgba(15,23,42,0.04)" : "rgba(255,255,255,0.08)",
                                  border: `1px solid ${borderColor}`,
                                  color: textColor,
                                  cursor: "pointer",
                                  width: "32px",
                                  height: "32px",
                                  borderRadius: "50%",
                                  display: "grid",
                                  placeItems: "center",
                                  flexShrink: 0,
                                  padding: 0,
                                  transition: "all 0.15s ease",
                                }}
                                aria-label="Back to inquiries"
                              >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="19" y1="12" x2="5" y2="12" />
                                  <polyline points="12 19 5 12 12 5" />
                                </svg>
                              </button>
                            )}

                            {/* Specialist Avatar with Live Status Indicator */}
                            <div style={{ position: "relative", flexShrink: 0 }}>
                              <div
                                style={{
                                  width: isMobile ? "30px" : "32px",
                                  height: isMobile ? "30px" : "32px",
                                  borderRadius: "50%",
                                  background: `linear-gradient(135deg, ${accentColor}25, ${accentColor}10)`,
                                  border: `1.5px solid ${accentColor}40`,
                                  display: "grid",
                                  placeItems: "center",
                                  color: accentColor,
                                }}
                              >
                                <svg width={isMobile ? "15" : "16"} height={isMobile ? "15" : "16"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                                  <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                                </svg>
                              </div>
                              <span
                                style={{
                                  position: "absolute",
                                  bottom: "-1px",
                                  right: "-1px",
                                  width: "8px",
                                  height: "8px",
                                  borderRadius: "50%",
                                  background:
                                    ticketDetail.status === "closed"
                                      ? "#94a3b8"
                                      : ticketDetail.status === "resolved"
                                        ? "#16a34a"
                                        : ticketDetail.status === "in_progress"
                                          ? "#7c3aed"
                                          : ticketDetail.status === "waiting_customer"
                                            ? "#d97706"
                                            : accentColor,
                                  border: `1.5px solid ${isLight ? "#ffffff" : "#1e293b"}`,
                                }}
                              />
                            </div>

                            {/* Title & Metadata (Clean & Concise) */}
                            <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                                <span
                                  style={{
                                    fontSize: "10.5px",
                                    fontWeight: 800,
                                    color: accentColor,
                                    fontFamily: "monospace",
                                    flexShrink: 0,
                                  }}
                                >
                                  #{ticketDetail.ticket_number}
                                </span>
                                <span
                                  style={{
                                    fontSize: isMobile ? "12.5px" : "13px",
                                    fontWeight: 700,
                                    color: titleColor,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {ticketDetail.subject}
                                </span>
                              </div>

                              {/* Subtitle with Real Ticket Status & Essential Info */}
                              <div style={{ fontSize: "10px", color: textMuted, marginTop: "1px", display: "flex", alignItems: "center", gap: "4px", overflow: "hidden", whiteSpace: "nowrap" }}>
                                {ticketDetail.status === "closed" ? (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: "#64748b", fontWeight: 600 }}>
                                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                    </svg>
                                    <span>Closed</span>
                                  </span>
                                ) : ticketDetail.status === "resolved" ? (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: "#16a34a", fontWeight: 600 }}>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                    <span>Resolved</span>
                                  </span>
                                ) : ticketDetail.status === "in_progress" ? (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: "#7c3aed", fontWeight: 600 }}>
                                    <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#7c3aed" }} />
                                    <span>In Progress</span>
                                  </span>
                                ) : ticketDetail.status === "waiting_customer" ? (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: "#d97706", fontWeight: 600 }}>
                                    <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#d97706" }} />
                                    <span>Specialist Replied</span>
                                  </span>
                                ) : (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", color: accentColor, fontWeight: 600 }}>
                                    <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: accentColor }} />
                                    <span>Open</span>
                                  </span>
                                )}
                                {ticketDetail.category && (
                                  <>
                                    <span>•</span>
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {renderCategoryIcon(ticketDetail.category, 10)}
                                      <span>{ticketDetail.category.replace(/_/g, " ")}</span>
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Actions on Right: End Chat Button */}
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                            {/* End Chat Button */}
                            {ticketDetail.status !== "resolved" && ticketDetail.status !== "closed" && (
                              <button
                                type="button"
                                onClick={handleCloseTicket}
                                disabled={closingTicket}
                                title="End Chat"
                                style={{
                                  height: "28px",
                                  padding: isMobile ? "0 8px" : "0 10px",
                                  borderRadius: buttonRadius,
                                  border: `1px solid ${borderColor}`,
                                  background: isLight ? "rgba(239, 68, 68, 0.06)" : "rgba(239, 68, 68, 0.12)",
                                  color: isLight ? "#dc2626" : "#f87171",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  cursor: closingTicket ? "not-allowed" : "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <span>{closingTicket ? "Ending..." : "End Chat"}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Linked Order Context Bar (if attached) */}
                        {ticketDetail.order_items_summary && (
                          <div
                            style={{
                              padding: "4px 12px",
                              background: isLight ? "#f8fafc" : "#131c31",
                              borderBottom: `1px solid ${borderColor}`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "8px",
                              fontSize: "10.5px",
                              flexShrink: 0,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0, flex: 1 }}>
                              {ticketDetail.order_items_summary.image_url ? (
                                <img
                                  src={ticketDetail.order_items_summary.image_url}
                                  alt=""
                                  style={{
                                    width: "22px",
                                    height: "22px",
                                    borderRadius: "4px",
                                    objectFit: "cover",
                                    border: `1px solid ${borderColor}`,
                                    flexShrink: 0,
                                    cursor: "zoom-in",
                                  }}
                                  onClick={() => setActiveZoomPhoto(ticketDetail.order_items_summary.image_url)}
                                />
                              ) : (
                                <div style={{ width: "22px", height: "22px", borderRadius: "4px", background: surfaceBg, display: "grid", placeItems: "center", color: textMuted, flexShrink: 0 }}>
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                                    <line x1="3" y1="6" x2="21" y2="6" />
                                    <path d="M16 10a4 4 0 0 1-8 0" />
                                  </svg>
                                </div>
                              )}
                              <div style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                <span style={{ fontWeight: 700, color: textColor }}>
                                  {ticketDetail.order_items_summary.product_name}
                                </span>
                                {ticketDetail.order_items_summary.variant_title && (
                                  <span style={{ color: textMuted, marginLeft: "4px" }}>
                                    ({ticketDetail.order_items_summary.variant_title})
                                  </span>
                                )}
                                {ticketDetail.order_items_summary.price ? (
                                  <span style={{ color: accentColor, fontWeight: 700, marginLeft: "6px" }}>
                                    ₹{ticketDetail.order_items_summary.price}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            {ticketDetail.order_id && (
                              <span style={{ fontSize: "10px", color: textMuted, fontFamily: "monospace", flexShrink: 0 }}>
                                Order #{ticketDetail.order_id.slice(0, 8)}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Messages Scroll Canvas */}
                        <div
                          ref={chatContainerRef}
                          onScroll={handleChatScroll}
                          onTouchStart={handleDismissKeyboard}
                          onMouseDown={handleDismissKeyboard}
                          className="custom-chat-scroll"
                          style={{
                            flex: 1,
                            minHeight: 0,
                            overflowY: "auto",
                            WebkitOverflowScrolling: "touch",
                            overscrollBehavior: "contain",
                            padding: isMobile ? "8px 8px" : "10px 16px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "7px",
                            background: chatBg || cardBg,
                          }}
                        >
                          {/* Older messages indicator / button */}
                          {hasMoreOlderMessages && (
                            <div
                              onClick={() => {
                                if (!chatLoading && !messagesLoadingOlder && selectedTicketId) {
                                  loadTicketDetail(selectedTicketId, messagesPage + 1, true, false);
                                }
                              }}
                              style={{
                                padding: "4px 10px",
                                textAlign: "center",
                                fontSize: "10.5px",
                                color: accentColor,
                                background: `${accentColor}12`,
                                borderRadius: "100px",
                                cursor: messagesLoadingOlder ? "default" : "pointer",
                                alignSelf: "center",
                                margin: "0 auto 4px",
                                border: `1px solid ${accentColor}25`,
                                fontWeight: 600,
                                userSelect: "none",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "5px",
                                transition: "all 0.15s ease",
                              }}
                            >
                              {messagesLoadingOlder ? (
                                <span>Loading earlier messages...</span>
                              ) : (
                                <>
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="18 15 12 9 6 15" />
                                  </svg>
                                  <span>Load earlier messages</span>
                                </>
                              )}
                            </div>
                          )}

                          {chatLoading && messages.length === 0 ? (
                            <div style={{ padding: "30px", textAlign: "center", color: textMuted, fontSize: "12px" }}>
                              Loading conversation...
                            </div>
                          ) : messages.length === 0 ? (
                            <div style={{ padding: "30px 16px", textAlign: "center", color: textMuted }}>
                              <div
                                style={{
                                  width: "36px",
                                  height: "36px",
                                  borderRadius: "50%",
                                  background: `${accentColor}12`,
                                  color: accentColor,
                                  display: "grid",
                                  placeItems: "center",
                                  margin: "0 auto 8px auto",
                                }}
                              >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                </svg>
                              </div>
                              <div style={{ fontSize: "12.5px", fontWeight: 700, color: textColor, marginBottom: "2px" }}>
                                Inquiry Started
                              </div>
                              <div style={{ fontSize: "11.5px" }}>
                                Our customer care specialist will respond shortly.
                              </div>
                            </div>
                          ) : (
                            messages.map((m, idx) => {
                              const isCustomer = m.sender_type === "customer";
                              const currentDateGroup = formatMessageDateGroup(m.created_at);
                              const prevDateGroup = idx > 0 ? formatMessageDateGroup(messages[idx - 1]?.created_at) : null;
                              const showDateSeparator = currentDateGroup && currentDateGroup !== prevDateGroup;

                              return (
                                <React.Fragment key={m.id || m.created_at || idx}>
                                  {/* Frosted Date Chip Separator */}
                                  {showDateSeparator && (
                                    <div
                                      style={{
                                        alignSelf: "center",
                                        margin: "6px 0 3px",
                                        padding: "2px 8px",
                                        borderRadius: "100px",
                                        background: isLight ? "rgba(15,23,42,0.06)" : "rgba(255,255,255,0.08)",
                                        backdropFilter: "blur(8px)",
                                        color: textMuted,
                                        fontSize: "9.5px",
                                        fontWeight: 700,
                                        userSelect: "none",
                                      }}
                                    >
                                      {currentDateGroup}
                                    </div>
                                  )}

                                  {/* Message Bubble Container */}
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "flex-end",
                                      gap: "6px",
                                      maxWidth: isMobile ? (effectiveViewportWidth > 640 ? "75%" : "90%") : "78%",
                                      alignSelf: isCustomer ? "flex-end" : "flex-start",
                                      animation: "messageSlideIn 0.2s ease-out",
                                    }}
                                  >
                                    {/* Agent Avatar on Staff Messages */}
                                    {!isCustomer && (
                                      <div
                                        style={{
                                          width: "24px",
                                          height: "24px",
                                          borderRadius: "50%",
                                          background: isLight ? "#ffffff" : "#1e293b",
                                          border: `1px solid ${borderColor}`,
                                          display: "grid",
                                          placeItems: "center",
                                          color: accentColor,
                                          flexShrink: 0,
                                          marginBottom: "2px",
                                        }}
                                      >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                                          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                                        </svg>
                                      </div>
                                    )}

                                    <div
                                      style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: isCustomer ? "flex-end" : "flex-start",
                                        minWidth: 0,
                                      }}
                                    >
                                      {/* Sender Header Name & Time */}
                                      <div
                                        style={{
                                          fontSize: "9.5px",
                                          color: textMuted,
                                          marginBottom: "2px",
                                          padding: "0 3px",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "4px",
                                        }}
                                      >
                                        <span style={{ fontWeight: 600 }}>
                                          {isCustomer ? "You" : m.sender_name || "Support Specialist"}
                                        </span>
                                        {!isCustomer && (
                                          <span
                                            style={{
                                              fontSize: "8.5px",
                                              fontWeight: 800,
                                              background: `${accentColor}18`,
                                              color: accentColor,
                                              padding: "0.5px 3px",
                                              borderRadius: "3px",
                                              textTransform: "uppercase",
                                            }}
                                          >
                                            Staff
                                          </span>
                                        )}
                                        <span>•</span>
                                        <span>
                                          {m.created_at
                                            ? new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                                            : ""}
                                        </span>
                                        {isCustomer && (
                                          <MessageStatusTick
                                            isSending={String(m.id || "").startsWith("temp_")}
                                            readAt={m.read_at}
                                            isCustomerBubble={true}
                                          />
                                        )}
                                      </div>

                                      {/* Bubble Body */}
                                      <div
                                        style={{
                                          padding: "7px 11px",
                                          borderRadius: isCustomer
                                            ? `${bubbleRadius} ${bubbleRadius} 2px ${bubbleRadius}`
                                            : `${bubbleRadius} ${bubbleRadius} ${bubbleRadius} 2px`,
                                          background: isCustomer
                                            ? customerBubbleBg
                                            : agentBubbleBg,
                                          color: isCustomer
                                            ? customerBubbleText
                                            : agentBubbleText,
                                          fontSize: "12.5px",
                                          lineHeight: "1.42",
                                          border: isCustomer ? "none" : `1px solid ${borderColor}`,
                                          wordBreak: "break-word",
                                          boxShadow: isCustomer
                                            ? `0 2px 8px rgba(0,0,0,0.12)`
                                            : "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
                                        }}
                                      >
                                        {(() => {
                                          const parsed = parseMessageWithMedia(m.message, m.attachments);
                                          const allImages = Array.from(
                                            new Set([
                                              ...(m.attachments || []).map(resolveMediaUrl),
                                              ...parsed.inlineImages,
                                            ])
                                          );

                                          return (
                                            <>
                                              {parsed.cleanText && <div>{parsed.cleanText}</div>}
                                              {allImages.length > 0 && (
                                                <div
                                                  style={{
                                                    marginTop: parsed.cleanText ? "8px" : "0",
                                                    display: "flex",
                                                    gap: "8px",
                                                    flexWrap: "wrap",
                                                  }}
                                                >
                                                  {allImages.map((url: string, i: number) => (
                                                    <AdaptiveSupportImage
                                                      key={i}
                                                      src={url}
                                                      alt="Attachment"
                                                      isStaff={!isCustomer}
                                                      onClickZoom={(zoomUrl) => setActiveZoomPhoto(zoomUrl)}
                                                    />
                                                  ))}
                                                </div>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </div>
                                    </div>
                                  </div>
                                </React.Fragment>
                              );
                            })
                          )}
                        </div>

                        {/* Photo Attachment Strip (Ready to Send) */}
                        {chatImage && (
                          <div
                            style={{
                              padding: "8px 14px",
                              background: surfaceBg,
                              borderTop: `1px solid ${borderColor}`,
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              flexShrink: 0,
                            }}
                          >
                            <img
                              src={chatImage.previewUrl}
                              alt=""
                              style={{ width: "38px", height: "38px", borderRadius: "6px", objectFit: "cover", border: `1px solid ${borderColor}` }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: "12px", fontWeight: 700, color: textColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {chatImage.file.name}
                              </div>
                              <div style={{ fontSize: "10.5px", color: textMuted }}>
                                {(chatImage.file.size / 1024).toFixed(0)} KB • Ready to send
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                URL.revokeObjectURL(chatImage.previewUrl);
                                setChatImage(null);
                              }}
                              style={{
                                background: "rgba(0,0,0,0.06)",
                                border: "none",
                                borderRadius: "50%",
                                width: "24px",
                                height: "24px",
                                color: textMuted,
                                cursor: "pointer",
                                display: "grid",
                                placeItems: "center",
                                padding: 0,
                              }}
                              title="Remove photo"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        )}

                        {/* Message Input Bar or Closed State */}
                        {ticketDetail.status === "closed" && !isAdminPhoneView ? (
                          <div
                            style={{
                              padding: "12px 18px",
                              background: surfaceBg,
                              borderTop: `1px solid ${borderColor}`,
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: "12px",
                              flexShrink: 0,
                            }}
                          >
                            <div style={{ fontSize: "12.5px", color: textMuted, display: "flex", alignItems: "center", gap: "6px" }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <polyline points="12 6 12 12 14 14" />
                              </svg>
                              <span>This chat has ended. Need more help?</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveTab("new");
                                setChatOpen(false);
                              }}
                              style={{
                                padding: "6px 14px",
                                borderRadius: buttonRadius,
                                border: "none",
                                background: accentColor,
                                color: buttonTextColor,
                                fontSize: "12px",
                                fontWeight: 700,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              + New Request
                            </button>
                          </div>
                        ) : (
                          <>
                            {ticketDetail.status === "closed" && isAdminPhoneView && (
                              <div
                                style={{
                                  padding: "6px 14px",
                                  background: isLight ? "rgba(100,116,139,0.08)" : "rgba(100,116,139,0.18)",
                                  borderTop: `1px solid ${borderColor}`,
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  gap: "10px",
                                  flexShrink: 0,
                                  fontSize: "11.5px",
                                  color: textMuted,
                                }}
                              >
                                <span>Ticket closed (Admin Preview)</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveTab("new");
                                    setChatOpen(false);
                                  }}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    color: accentColor,
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  + New Request
                                </button>
                              </div>
                            )}
                            <form
                              onSubmit={handleSendReply}
                              style={{
                                padding: isMobile ? (isKeyboardActive ? "6px 8px" : "6px 8px calc(6px + env(safe-area-inset-bottom))") : "7px 14px",
                                background: cardBg,
                                borderTop: `1px solid ${borderColor}`,
                                display: "flex",
                                gap: "7px",
                                alignItems: "center",
                                zIndex: 10,
                                flexShrink: 0,
                                boxShadow: "0 -2px 10px rgba(0,0,0,0.03)",
                                touchAction: "none",
                              }}
                            >
                              <input
                                type="file"
                                ref={chatFileInputRef}
                                accept="image/*"
                                style={{ display: "none" }}
                                onChange={async (e) => {
                                  const rawFile = e.target.files?.[0];
                                  if (rawFile) {
                                    const file = await compressImageFile(rawFile, 1600, 1600, 0.82);
                                    const previewUrl = URL.createObjectURL(file);
                                    setChatImage({ file, previewUrl });
                                  }
                                  e.target.value = "";
                                }}
                              />

                              {/* Paperclip File Upload Button (Controlled by allowAttachments toggle) */}
                              {allowAttachments && (
                                <button
                                  type="button"
                                  onClick={() => chatFileInputRef.current?.click()}
                                  disabled={sendingReply}
                                  title="Attach photo"
                                  style={{
                                    width: "32px",
                                    height: "32px",
                                    borderRadius: "50%",
                                    border: `1px solid ${borderColor}`,
                                    background: chatImage ? `${accentColor}18` : isLight ? (cardBg === "#ffffff" ? "#f8fafc" : "rgba(0,0,0,0.04)") : "rgba(255,255,255,0.06)",
                                    color: chatImage ? accentColor : textMuted,
                                    display: "grid",
                                    placeItems: "center",
                                    cursor: "pointer",
                                    flexShrink: 0,
                                    transition: "all 0.15s ease",
                                  }}
                                >
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                                  </svg>
                                </button>
                              )}

                              {/* Text Message Input Field (Kept enabled so keyboard never closes on send) */}
                              <input
                                ref={chatInputRef}
                                type="text"
                                placeholder={chatImage ? "Add photo caption..." : "Type your message..."}
                                value={replyText}
                                onChange={(e) => setReplyText(e.target.value)}
                                onPaste={handlePasteImage}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendReply(e);
                                  }
                                }}
                                onFocus={() => {
                                  setInputFocused(true);
                                  if (!isAdmin && typeof window !== "undefined") {
                                    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
                                    document.body.scrollTop = 0;
                                  }
                                  [40, 120, 250, 400, 600].forEach((delay) => {
                                    setTimeout(() => {
                                      if (!isAdmin && typeof window !== "undefined" && window.scrollY !== 0) {
                                        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
                                      }
                                      if (chatContainerRef.current) {
                                        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
                                      }
                                    }, delay);
                                  });
                                }}
                                onBlur={() => {
                                  setInputFocused(false);
                                  if (!isAdmin && typeof window !== "undefined") {
                                    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
                                    document.body.scrollTop = 0;
                                  }
                                }}
                                style={{
                                  flex: 1,
                                  padding: "7px 14px",
                                  borderRadius: inputRadius,
                                  border: `1px solid ${inputBorder}`,
                                  background: inputBg || (isLight ? "#f1f5f9" : "#0f172a"),
                                  color: inputTextColor,
                                  fontSize: isMobile ? "16px" : "12.5px",
                                  outline: "none",
                                  minHeight: isMobile ? "36px" : "34px",
                                  boxSizing: "border-box",
                                  transition: "border-color 0.15s ease",
                                }}
                              />

                              {/* Send Message Button (Does not blur input on click/tap) */}
                              <button
                                type="submit"
                                disabled={sendingReply || (!replyText.trim() && !chatImage)}
                                onMouseDown={(e) => e.preventDefault()}
                                onTouchStart={(e) => e.preventDefault()}
                                onPointerDown={(e) => e.preventDefault()}
                                style={{
                                  width: "34px",
                                  height: "34px",
                                  borderRadius: "50%",
                                  border: "none",
                                  padding: 0,
                                  margin: 0,
                                  background: (!replyText.trim() && !chatImage)
                                    ? isLight ? "#e2e8f0" : "#334155"
                                    : `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)`,
                                  color: "#ffffff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  cursor: sendingReply || (!replyText.trim() && !chatImage) ? "not-allowed" : "pointer",
                                  flexShrink: 0,
                                  transition: "all 0.15s ease",
                                  boxShadow: (replyText.trim() || chatImage) ? `0 2px 8px ${accentColor}40` : "none",
                                  outline: "none",
                                }}
                                aria-label="Send message"
                              >
                                <svg
                                  width="15"
                                  height="15"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  style={{ display: "block" }}
                                >
                                  <line x1="12" y1="19" x2="12" y2="5" />
                                  <polyline points="5 12 12 5 19 12" />
                                </svg>
                              </button>
                            </form>
                          </>
                        )}
                      </>
                    ) : (
                      /* Zero State: No Ticket Selected on Desktop */
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", textAlign: "center" }}>
                        <div
                          style={{
                            width: "56px",
                            height: "56px",
                            borderRadius: "50%",
                            background: `${accentColor}12`,
                            color: accentColor,
                            display: "grid",
                            placeItems: "center",
                            marginBottom: "14px",
                          }}
                        >
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                        </div>
                        <div style={{ fontSize: "16px", fontWeight: 800, color: titleColor, marginBottom: "6px" }}>
                          {tickets.length > 0 ? "Select an Inquiry" : "No Support Requests Yet"}
                        </div>
                        <p style={{ fontSize: "13px", color: textMuted, maxWidth: "340px", margin: "0 0 18px", lineHeight: 1.5 }}>
                          {tickets.length > 0
                            ? "Choose a request on the left to view the live conversation history and reply to support."
                            : "Have questions about an order or product? Start a conversation with our customer care team."}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab("new");
                            setChatOpen(false);
                          }}
                          style={{
                            padding: "8px 20px",
                            borderRadius: buttonRadius,
                            border: "none",
                            background: accentColor,
                            color: buttonTextColor,
                            fontSize: "12.5px",
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span>+ Open New Request</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: NEW REQUEST FORM (Clean & Organized Single Screen) */}
            {activeTab === "new" && (
              <div
                style={{
                  background: cardBg,
                  borderRadius: cardRadius,
                  border: `1px solid ${borderColor}`,
                  padding: cardPadding,
                  width: "100%",
                  boxSizing: "border-box",
                  flex: (!isAdmin && !isMobile) ? "1 1 0%" : "none",
                  minHeight: isDesktopAdmin ? "440px" : (!isAdmin && !isMobile ? "0px" : "auto"),
                  height: (!isAdmin && !isMobile) ? "100%" : "auto",
                  maxHeight: (!isAdmin && !isMobile) ? "100%" : "none",
                  display: "flex",
                  flexDirection: "column",
                  overflow: (!isAdmin && !isMobile) ? "hidden" : "visible",
                }}
              >
                <div style={{ marginBottom: "12px", flexShrink: 0 }}>
                  <h2 style={{ margin: "0 0 4px", fontSize: "16px", fontWeight: 800, color: titleColor }}>
                    Open a Support Request
                  </h2>
                  <p style={{ margin: 0, fontSize: "12.5px", color: textMuted }}>
                    Fill in the details below and our team will get back to you promptly.
                  </p>
                </div>

                {submitError && (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: buttonRadius,
                      background: "rgba(239, 68, 68, 0.1)",
                      border: "1px solid rgba(239, 68, 68, 0.25)",
                      color: "#dc2626",
                      fontSize: "12.5px",
                      marginBottom: "12px",
                      flexShrink: 0,
                    }}
                  >
                    {submitError}
                  </div>
                )}

                <form
                  onSubmit={handleSubmitNewRequest}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px",
                    width: "100%",
                    flex: (!isAdmin && !isMobile) ? "1 1 0%" : "none",
                    minHeight: 0,
                    height: (!isAdmin && !isMobile) ? "100%" : "auto",
                    overflowY: (!isAdmin && !isMobile) ? "auto" : "visible",
                    paddingRight: "4px",
                  }}
                >
                  {/* Order & Product Selection Row */}
                  {allowOrderSelection && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMobile ? "1fr" : selectedOrderId ? "1fr 1fr" : "1fr",
                        gap: "14px",
                        width: "100%",
                      }}
                    >
                      {/* Order Selector */}
                      <div ref={orderDropdownRef} style={{ position: "relative" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                          <label style={{ fontSize: "12.5px", fontWeight: 700, color: textColor }}>
                            Relates to Order (Optional)
                          </label>
                          {selectedOrderId && (
                            <button
                              type="button"
                              onClick={() => {
                                handleOrderSelect("");
                                setOrderDropdownOpen(false);
                              }}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: accentColor,
                                fontSize: "11px",
                                fontWeight: 600,
                                cursor: "pointer",
                                padding: "2px 4px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "3px",
                              }}
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                              <span>Clear order</span>
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setOrderDropdownOpen((prev) => !prev);
                            setItemDropdownOpen(false);
                            setCategoryDropdownOpen(false);
                          }}
                          style={{
                            width: "100%",
                            minHeight: "44px",
                            padding: "8px 12px",
                            borderRadius: inputRadius,
                            border: orderDropdownOpen
                              ? `1.5px solid ${accentColor}`
                              : selectedOrderId
                                ? `1.5px solid ${accentColor}80`
                                : `1px solid ${inputBorder}`,
                            background: inputBg,
                            color: inputTextColor,
                            fontSize: "13px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "10px",
                            cursor: "pointer",
                            textAlign: "left",
                            boxSizing: "border-box",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
                            <div
                              style={{
                                width: "30px",
                                height: "30px",
                                borderRadius: "6px",
                                background: selectedOrderId ? `${accentColor}18` : surfaceBg,
                                border: `1px solid ${selectedOrderId ? `${accentColor}35` : borderColor}`,
                                display: "grid",
                                placeItems: "center",
                                color: selectedOrderId ? accentColor : textMuted,
                                flexShrink: 0,
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                                <line x1="12" y1="22.08" x2="12" y2="12" />
                              </svg>
                            </div>
                            {activeOrder ? (
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                  <span style={{ fontWeight: 700, color: textColor, fontFamily: "monospace", fontSize: "12.5px" }}>
                                    #{activeOrder.id.slice(0, 8)}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: "9px",
                                      fontWeight: 700,
                                      padding: "1px 5px",
                                      borderRadius: "100px",
                                      background: `${accentColor}15`,
                                      color: accentColor,
                                      textTransform: "capitalize",
                                    }}
                                  >
                                    {activeOrder.status ? activeOrder.status.replace(/_/g, " ") : "Placed"}
                                  </span>
                                  <span style={{ fontSize: "11px", color: textMuted }}>• ₹{activeOrder.total || 0}</span>
                                </div>
                                {activeOrder.created_at && (
                                  <div style={{ fontSize: "11px", color: textMuted, marginTop: "1px" }}>
                                    Placed on {formatOrderDate(activeOrder.created_at)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div style={{ fontSize: "12.5px", color: textMuted }}>
                                General Inquiry (No specific order)
                              </div>
                            )}
                          </div>
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={textMuted}
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                              transform: orderDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                              transition: "transform 0.2s ease",
                              flexShrink: 0,
                            }}
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>

                        {/* Order Dropdown Popover with Infinite Scroll */}
                        {orderDropdownOpen && (
                          <div
                            style={{
                              position: "absolute",
                              top: "calc(100% + 6px)",
                              left: 0,
                              right: 0,
                              background: cardBg,
                              border: `1px solid ${borderColor}`,
                              borderRadius: cardRadius,
                              boxShadow: "0 12px 28px rgba(0, 0, 0, 0.2)",
                              zIndex: 100,
                              display: "flex",
                              flexDirection: "column",
                              animation: "dropdownFadeIn 0.15s ease",
                              overflow: "hidden",
                            }}
                          >
                            {/* Scrollable Orders Area */}
                            <div
                              onScroll={handleOrderDropdownScroll}
                              style={{
                                maxHeight: "260px",
                                overflowY: "auto",
                                padding: "6px",
                                display: "flex",
                                flexDirection: "column",
                                gap: "4px",
                              }}
                            >
                              {/* Option 0: General inquiry */}
                              <div
                                onClick={() => {
                                  handleOrderSelect("");
                                  setOrderDropdownOpen(false);
                                }}
                                style={{
                                  padding: "8px 10px",
                                  borderRadius: innerRadius,
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  background: !selectedOrderId ? `${accentColor}14` : "transparent",
                                  color: textColor,
                                  fontSize: "12.5px",
                                }}
                              >
                                <span>General Inquiry (No specific order)</span>
                                {!selectedOrderId && (
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                )}
                              </div>

                              {ordersLoading && orders.length === 0 ? (
                                <div style={{ padding: "16px", textAlign: "center", fontSize: "12px", color: textMuted }}>
                                  Loading recent orders...
                                </div>
                              ) : orders.length === 0 ? (
                                <div style={{ padding: "14px 10px", textAlign: "center", fontSize: "12px", color: textMuted }}>
                                  No past orders found for this customer account.
                                </div>
                              ) : (
                                orders.map((ord) => {
                                  const isSelected = String(ord.id) === String(selectedOrderId);
                                  const itemsCount = Array.isArray(ord.items) ? ord.items.length : 1;
                                  const orderDate = formatOrderDate(ord.created_at);
                                  return (
                                    <div
                                      key={ord.id}
                                      onClick={() => {
                                        handleOrderSelect(ord.id);
                                        setOrderDropdownOpen(false);
                                      }}
                                      style={{
                                        padding: "8px 10px",
                                        borderRadius: innerRadius,
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: "8px",
                                        background: isSelected ? `${accentColor}14` : "transparent",
                                        color: textColor,
                                        fontSize: "12.5px",
                                        border: isSelected ? `1px solid ${accentColor}35` : "1px solid transparent",
                                        transition: "all 0.12s ease",
                                      }}
                                    >
                                      <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                          <span style={{ fontWeight: 700, fontFamily: "monospace" }}>#{ord.id.slice(0, 8)}</span>
                                          <span
                                            style={{
                                              fontSize: "8.5px",
                                              fontWeight: 700,
                                              padding: "0.5px 4px",
                                              borderRadius: "4px",
                                              background: `${accentColor}15`,
                                              color: accentColor,
                                              textTransform: "capitalize",
                                            }}
                                          >
                                            {ord.status ? ord.status.replace(/_/g, " ") : "Placed"}
                                          </span>
                                          <span style={{ fontSize: "11px", fontWeight: 600 }}>₹{ord.total || 0}</span>
                                        </div>
                                        <div style={{ fontSize: "10.5px", color: textMuted, marginTop: "2px", display: "flex", gap: "6px" }}>
                                          {orderDate && <span>Placed {orderDate}</span>}
                                          <span>•</span>
                                          <span>{itemsCount} {itemsCount === 1 ? "item" : "items"}</span>
                                        </div>
                                      </div>
                                      {isSelected && (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                          <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                      )}
                                    </div>
                                  );
                                })
                              )}

                              {ordersLoadingMore && (
                                <div style={{ padding: "8px", textAlign: "center", fontSize: "11px", color: textMuted }}>
                                  Loading more orders...
                                </div>
                              )}
                            </div>

                            {/* Subtle scroll hint footer */}
                            {ordersPage < ordersTotalPages && orders.length > 0 && (
                              <div
                                style={{
                                  padding: "5px 8px",
                                  borderTop: `1px solid ${borderColor}`,
                                  background: surfaceBg,
                                  textAlign: "center",
                                  fontSize: "10px",
                                  color: textMuted,
                                  fontWeight: 500,
                                }}
                              >
                                Showing {orders.length} of {ordersTotalCount || orders.length} — scroll for more
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Product Selector (Visible when order chosen) */}
                      {selectedOrderId && (
                        <div ref={itemDropdownRef} style={{ position: "relative" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                            <label style={{ fontSize: "12.5px", fontWeight: 700, color: textColor }}>
                              Select Product
                            </label>
                            {selectedOrderItemId && (
                              <button
                                type="button"
                                onClick={() => {
                                  handleOrderItemSelect("");
                                  setItemDropdownOpen(false);
                                }}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: accentColor,
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  padding: "2px 4px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "3px",
                                }}
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                                <span>Entire order</span>
                              </button>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setItemDropdownOpen((prev) => !prev);
                              setOrderDropdownOpen(false);
                              setCategoryDropdownOpen(false);
                            }}
                            style={{
                              width: "100%",
                              minHeight: "42px",
                              padding: "8px 12px",
                              borderRadius: inputRadius,
                              border: itemDropdownOpen
                                ? `1.5px solid ${accentColor}`
                                : selectedOrderItem
                                  ? `1.5px solid ${accentColor}80`
                                  : `1px solid ${inputBorder}`,
                              background: inputBg,
                              color: inputTextColor,
                              fontSize: "13px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "10px",
                              cursor: "pointer",
                              textAlign: "left",
                              boxSizing: "border-box",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
                              {selectedOrderItem ? (
                                <>
                                  {selectedOrderItem.product_image || selectedOrderItem.image_url ? (
                                    <img
                                      src={selectedOrderItem.product_image || selectedOrderItem.image_url}
                                      alt=""
                                      style={{ width: "26px", height: "26px", borderRadius: "4px", objectFit: "cover", flexShrink: 0 }}
                                    />
                                  ) : (
                                    <div style={{ width: "26px", height: "26px", borderRadius: "4px", background: surfaceBg, display: "grid", placeItems: "center", color: textMuted }}>
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                                      </svg>
                                    </div>
                                  )}
                                  <div style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12.5px", fontWeight: 700 }}>
                                    {selectedOrderItem.product_name}
                                  </div>
                                </>
                              ) : (
                                <span style={{ fontSize: "12.5px", color: textMuted }}>Entire Order (All items)</span>
                              )}
                            </div>
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke={textMuted}
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={{
                                transform: itemDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                                transition: "transform 0.2s ease",
                                flexShrink: 0,
                              }}
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </button>

                          {/* Product Popover */}
                          {itemDropdownOpen && (
                            <div
                              style={{
                                position: "absolute",
                                top: "calc(100% + 6px)",
                                left: 0,
                                right: 0,
                                background: cardBg,
                                border: `1px solid ${borderColor}`,
                                borderRadius: cardRadius,
                                boxShadow: "0 10px 25px rgba(0, 0, 0, 0.18)",
                                zIndex: 100,
                                maxHeight: "260px",
                                overflowY: "auto",
                                padding: "6px",
                                display: "flex",
                                flexDirection: "column",
                                gap: "4px",
                                animation: "dropdownFadeIn 0.15s ease",
                              }}
                            >
                              <div
                                onClick={() => {
                                  handleOrderItemSelect("");
                                  setItemDropdownOpen(false);
                                }}
                                style={{
                                  padding: "8px 10px",
                                  borderRadius: innerRadius,
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  background: !selectedOrderItemId ? `${accentColor}14` : "transparent",
                                  color: textColor,
                                  fontSize: "12.5px",
                                }}
                              >
                                <span>Entire Order (All items)</span>
                                {!selectedOrderItemId && (
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                )}
                              </div>

                              {activeOrderItems.map((it: any) => {
                                const itemId = String(it.id || it.order_item_id || it.product_id);
                                const isSelected = String(selectedOrderItemId) === itemId;
                                return (
                                  <div
                                    key={itemId}
                                    onClick={() => {
                                      handleOrderItemSelect(itemId);
                                      setItemDropdownOpen(false);
                                    }}
                                    style={{
                                      padding: "8px 10px",
                                      borderRadius: innerRadius,
                                      cursor: "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: "8px",
                                      background: isSelected ? `${accentColor}14` : "transparent",
                                      color: textColor,
                                      fontSize: "12.5px",
                                    }}
                                  >
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
                                      {it.product_image || it.image_url ? (
                                        <img
                                          src={it.product_image || it.image_url}
                                          alt=""
                                          style={{ width: "24px", height: "24px", borderRadius: "4px", objectFit: "cover", flexShrink: 0 }}
                                        />
                                      ) : null}
                                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {it.product_name} {it.variant_title ? `(${it.variant_title})` : ""}
                                      </span>
                                    </div>
                                    {isSelected && (
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                      </svg>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Category & Subject Row */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                      gap: "14px",
                      width: "100%",
                    }}
                  >
                    {/* Category Dropdown */}
                    <div ref={categoryDropdownRef} style={{ position: "relative" }}>
                      <label style={{ display: "block", fontSize: "12.5px", fontWeight: 700, color: textColor, marginBottom: "6px" }}>
                        Category *
                      </label>

                      <button
                        type="button"
                        onClick={() => {
                          setCategoryDropdownOpen((prev) => !prev);
                          setOrderDropdownOpen(false);
                          setItemDropdownOpen(false);
                        }}
                        style={{
                          width: "100%",
                          minHeight: "42px",
                          padding: "8px 12px",
                          borderRadius: inputRadius,
                          border: categoryDropdownOpen ? `1.5px solid ${accentColor}` : `1px solid ${inputBorder}`,
                          background: inputBg,
                          color: inputTextColor,
                          fontSize: "13px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "10px",
                          cursor: "pointer",
                          textAlign: "left",
                          boxSizing: "border-box",
                        }}
                      >
                        {(() => {
                          const cat = CATEGORIES.find((c) => c.id === selectedCategory) || CATEGORIES[0];
                          return (
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
                              <span style={{ color: accentColor, display: "grid", placeItems: "center" }}>
                                {renderCategoryIcon(selectedCategory, 15)}
                              </span>
                              <span style={{ fontWeight: 600, color: textColor, fontSize: "12.5px" }}>
                                {cat.label}
                              </span>
                            </div>
                          );
                        })()}
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={textMuted}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{
                            transform: categoryDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                            transition: "transform 0.2s ease",
                            flexShrink: 0,
                          }}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>

                      {/* Category Popover */}
                      {categoryDropdownOpen && (
                        <div
                          style={{
                            position: "absolute",
                            top: "calc(100% + 6px)",
                            left: 0,
                            right: 0,
                            background: cardBg,
                            border: `1px solid ${borderColor}`,
                            borderRadius: cardRadius,
                            boxShadow: "0 10px 25px rgba(0, 0, 0, 0.18)",
                            zIndex: 90,
                            maxHeight: "260px",
                            overflowY: "auto",
                            padding: "6px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "2px",
                            animation: "dropdownFadeIn 0.15s ease",
                          }}
                        >
                          {CATEGORIES.map((cat) => {
                            const isSelected = cat.id === selectedCategory;
                            return (
                              <div
                                key={cat.id}
                                onClick={() => {
                                  setSelectedCategory(cat.id);
                                  setCategoryDropdownOpen(false);
                                }}
                                style={{
                                  padding: "8px 10px",
                                  borderRadius: innerRadius,
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: "8px",
                                  background: isSelected ? `${accentColor}14` : "transparent",
                                  color: textColor,
                                  fontSize: "12.5px",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <span style={{ color: isSelected ? accentColor : textMuted }}>
                                    {renderCategoryIcon(cat.id, 14)}
                                  </span>
                                  <span style={{ fontWeight: isSelected ? 700 : 500, color: isSelected ? accentColor : textColor }}>
                                    {cat.label}
                                  </span>
                                </div>
                                {isSelected && (
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Subject Input */}
                    <div>
                      <label style={{ display: "block", fontSize: "12.5px", fontWeight: 700, color: textColor, marginBottom: "6px" }}>
                        Subject (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="Brief summary of request"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        onFocus={() => {
                          if (!isAdmin && typeof window !== "undefined") {
                            window.scrollTo({ top: 0, left: 0, behavior: "instant" });
                          }
                        }}
                        style={{
                          width: "100%",
                          minHeight: "42px",
                          padding: "8px 12px",
                          borderRadius: inputRadius,
                          border: `1px solid ${inputBorder}`,
                          background: inputBg,
                          color: inputTextColor,
                          fontSize: isMobile ? "16px" : "13px",
                          boxSizing: "border-box",
                          outline: "none",
                        }}
                      />
                    </div>
                  </div>

                  {/* Details Textarea */}
                  <div>
                    <label style={{ display: "block", fontSize: "12.5px", fontWeight: 700, color: textColor, marginBottom: "6px" }}>
                      Details *
                    </label>
                    <textarea
                      rows={4}
                      placeholder="Describe your issue or query..."
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onFocus={() => {
                        if (!isAdmin && typeof window !== "undefined") {
                          window.scrollTo({ top: 0, left: 0, behavior: "instant" });
                        }
                      }}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: inputRadius,
                        border: `1px solid ${inputBorder}`,
                        background: inputBg,
                        color: inputTextColor,
                        fontSize: isMobile ? "16px" : "13px",
                        fontFamily: "inherit",
                        resize: "vertical",
                        boxSizing: "border-box",
                        outline: "none",
                        minHeight: "100px",
                      }}
                    />
                  </div>

                  {/* Photo Upload Box (Upload Only - No text link) */}
                  {allowAttachments && (
                    <div>
                      <label style={{ display: "block", fontSize: "12.5px", fontWeight: 700, color: textColor, marginBottom: "6px" }}>
                        Attach Photo / Screenshot (Optional)
                      </label>

                      <input
                        type="file"
                        ref={newRequestFileInputRef}
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={async (e) => {
                          const rawFile = e.target.files?.[0];
                          if (rawFile) {
                            const file = await compressImageFile(rawFile, 1600, 1600, 0.82);
                            const previewUrl = URL.createObjectURL(file);
                            setNewRequestImage({ file, previewUrl });
                          }
                          e.target.value = "";
                        }}
                      />

                      {newRequestImage ? (
                        <div
                          style={{
                            padding: "8px 12px",
                            background: surfaceBg,
                            border: `1px solid ${borderColor}`,
                            borderRadius: inputRadius,
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                          }}
                        >
                          <img
                            src={newRequestImage.previewUrl}
                            alt=""
                            style={{ width: "42px", height: "42px", borderRadius: "6px", objectFit: "cover", cursor: "zoom-in" }}
                            onClick={() => setActiveZoomPhoto(newRequestImage.previewUrl)}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "12px", fontWeight: 600, color: textColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {newRequestImage.file.name}
                            </div>
                            <div style={{ fontSize: "11px", color: textMuted }}>
                              {(newRequestImage.file.size / 1024).toFixed(0)} KB
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              URL.revokeObjectURL(newRequestImage.previewUrl);
                              setNewRequestImage(null);
                            }}
                            style={{
                              background: "transparent",
                              border: `1px solid ${borderColor}`,
                              borderRadius: "6px",
                              color: textMuted,
                              cursor: "pointer",
                              padding: "4px 8px",
                              fontSize: "11px",
                              fontWeight: 600,
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => newRequestFileInputRef.current?.click()}
                          style={{
                            width: "100%",
                            padding: "12px 14px",
                            borderRadius: inputRadius,
                            border: `1.5px dashed ${borderColor}`,
                            background: surfaceBg,
                            color: textMuted,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "8px",
                            fontSize: "12.5px",
                            fontWeight: 600,
                            transition: "all 0.15s ease",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.borderColor = accentColor)}
                          onMouseLeave={(e) => (e.currentTarget.style.borderColor = borderColor)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                          </svg>
                          <span>Click to upload image (JPG, PNG, WebP)</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Submit & Contact Bar */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: isMobile ? "stretch" : "center",
                      flexDirection: isMobile ? "column" : "row",
                      gap: "12px",
                      paddingTop: "4px",
                    }}
                  >
                    <button
                      type="submit"
                      disabled={submitting}
                      style={{
                        padding: "10px 24px",
                        borderRadius: buttonRadius,
                        border: "none",
                        background: accentColor,
                        color: buttonTextColor,
                        fontSize: "13px",
                        fontWeight: 700,
                        cursor: submitting ? "not-allowed" : "pointer",
                        opacity: submitting ? 0.7 : 1,
                        textAlign: "center",
                      }}
                    >
                      {submitting ? (uploadingNewRequestImage ? "Uploading Photo..." : "Submitting...") : submitButtonText}
                    </button>

                    {!isMobile && showContactInfo && (supportEmail || siteContactEmail || supportPhone || siteContactPhone || supportHours) && (
                      <div style={{ fontSize: "11.5px", color: textMuted, display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                        {(supportEmail || siteContactEmail) && (
                          <span>Email: <strong style={{ color: textColor }}>{supportEmail || siteContactEmail}</strong></span>
                        )}
                        {(supportPhone || siteContactPhone) && (
                          <span>Phone: <strong style={{ color: textColor }}>{supportPhone || siteContactPhone}</strong></span>
                        )}
                        {supportHours && (
                          <span>Hours: <strong style={{ color: textColor }}>{supportHours}</strong></span>
                        )}
                      </div>
                    )}
                  </div>
                </form>
              </div>
            )}
          </>
        )}

        {/* Fullscreen Lightbox Zoom Modal */}
        <SupportImageZoomModal
          imageUrl={activeZoomPhoto}
          onClose={() => setActiveZoomPhoto(null)}
          title="Support Attachment Proof"
        />
      </div>
    </div>
  );
}
