/**
 * Evolution v1.1 Shopify action engine.
 *
 * The model and browser may prepare proposals. Only runActionExecute can
 * mutate Shopify, and it loads the immutable proposal from server storage.
 */
import { resolveUserFull } from "./_audit";
import { isOperator, OPERATOR_REQUIRED } from "./_plan";
import {
  getConnection,
  SHOPIFY_API_VERSION,
  type ShopifyConnection,
  type ShopifyEnv,
} from "./_shopify";
import { log } from "./_log";

export type ShopifyActionKind =
  | "product_update"
  | "product_draft_create"
  | "collection_upsert"
  | "discount_code_create"
  | "discount_automatic_create";

export type ShopifyActionStatus =
  | "proposed"
  | "executing"
  | "succeeded"
  | "partial"
  | "failed"
  | "stale"
  | "undone"
  | "expired"
  | "rejected";

export interface ActionEnv extends ShopifyEnv { cronSecret?: string }

export function actionEnvFromProcess(): ActionEnv {
  const base = (process.env as Record<string, string | undefined>);
  return {
    groqKey: (base.GROQ_API_KEY ?? "").trim(),
    groqModel: (base.GROQ_CHAT_MODEL ?? "").trim(),
    groqResearchModel: (base.GROQ_RESEARCH_MODEL ?? "").trim(),
    adminEmails: (base.ADMIN_EMAILS ?? "").trim(),
    supabaseUrl: (base.SUPABASE_URL ?? base.VITE_SUPABASE_URL ?? "").trim(),
    serviceRoleKey: (base.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
    shopifyApiKey: (base.SHOPIFY_API_KEY ?? "").trim(),
    shopifyApiSecret: (base.SHOPIFY_API_SECRET ?? "").trim(),
    shopifyScopes: (base.SHOPIFY_SCOPES ?? "").trim(),
    cronSecret: (base.CRON_SECRET ?? "").trim(),
  };
}

export interface ShopifyActionRow {
  id: string;
  user_id: string;
  shop_domain: string;
  kind: ShopifyActionKind;
  status: ShopifyActionStatus;
  summary: string;
  payload: Record<string, unknown>;
  before_state: Record<string, unknown>;
  after_state?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  expires_at: string;
  approved_at?: string | null;
  executed_at?: string | null;
  undone_at?: string | null;
  created_at: string;
}

interface ProductPatch {
  productId: string;
  title?: string;
  descriptionHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  tags?: string[];
  vendor?: string;
  productType?: string;
  mediaAlt?: { id: string; alt: string }[];
}

interface DiscountSpec {
  title: string;
  code?: string;
  valueType: "percentage" | "fixed" | "free_shipping";
  value?: number;
  startsAt: string;
  endsAt?: string | null;
  minimumSubtotal?: number | null;
  usageLimit?: number | null;
  appliesOncePerCustomer?: boolean;
  productIds?: string[];
}

export interface ActionProposeBody {
  kind?: unknown;
  summary?: unknown;
  items?: unknown;
  product?: unknown;
  collection?: unknown;
  discount?: unknown;
  evidence?: unknown;
  optimizerVersion?: unknown;
  targetMarket?: unknown;
  keywordPlan?: unknown;
  sourceStatus?: unknown;
  confirmedFacts?: unknown;
  geoPlan?: unknown;
}

const ACTION_SELECT =
  "id,user_id,shop_domain,kind,status,summary,payload,before_state,after_state,result,error,expires_at,approved_at,executed_at,undone_at,created_at";
const MAX_BATCH = 10;
const MAX_TEXT = 20_000;
const gid = (type: string, raw: unknown): string | null => {
  const value = typeof raw === "string" ? raw.trim() : "";
  return new RegExp(`^gid://shopify/${type}/\\d+$`).test(value) ? value : null;
};
const cleanText = (raw: unknown, max = 255): string =>
  (typeof raw === "string" ? raw : "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
const safeHtml = (raw: unknown): string => {
  const value = typeof raw === "string" ? raw.slice(0, MAX_TEXT) : "";
  return value
    .replace(/<\/?(?:script|style|iframe|object|embed|form)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, "");
};
const stringList = (raw: unknown, max = 100): string[] =>
  Array.isArray(raw)
    ? [...new Set(raw.map((v) => cleanText(v, 255)).filter(Boolean))].slice(0, max)
    : [];
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function scopes(conn: ShopifyConnection): Set<string> {
  return new Set((conn.scopes ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

function requiredScope(kind: ShopifyActionKind): string[] {
  if (kind === "discount_code_create" || kind === "discount_automatic_create") return ["write_discounts"];
  if (kind === "product_update") return ["write_products"];
  return ["write_products"];
}

function scopeError(conn: ShopifyConnection, kind: ShopifyActionKind, needsFiles = false): string | null {
  const granted = scopes(conn);
  const missing = requiredScope(kind).filter((s) => !granted.has(s));
  if (needsFiles && !granted.has("write_files")) missing.push("write_files");
  return missing.length ? `Reconnect Shopify to grant: ${[...new Set(missing)].join(", ")}.` : null;
}

async function gql<T>(
  conn: ShopifyConnection,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data: T | null; errors: string[] }> {
  try {
    const res = await fetch(`https://${conn.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "X-Shopify-Access-Token": conn.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(12_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: T;
      errors?: { message?: string }[];
    };
    return {
      data: res.ok ? body.data ?? null : null,
      errors: (body.errors ?? []).map((e) => e.message ?? "Shopify rejected the request."),
    };
  } catch (error) {
    return { data: null, errors: [String(error).slice(0, 180)] };
  }
}

const PRODUCTS_STATE = `query ActionProducts($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Product {
    id updatedAt title descriptionHtml tags status vendor productType
    seo { title description }
    media(first: 50) { nodes { id alt } }
  } }
}`;

interface ProductState {
  id: string;
  updatedAt: string;
  title: string;
  descriptionHtml: string;
  tags: string[];
  vendor: string;
  productType: string;
  status: string;
  seo: { title?: string | null; description?: string | null };
  media: { nodes: { id: string; alt?: string | null }[] };
}

async function productStates(conn: ShopifyConnection, ids: string[]): Promise<ProductState[] | null> {
  const { data } = await gql<{ nodes?: (ProductState | null)[] }>(conn, PRODUCTS_STATE, { ids });
  const rows = (data?.nodes ?? []).filter((v): v is ProductState => Boolean(v?.id));
  return rows.length === ids.length ? rows : null;
}

async function collectionState(conn: ShopifyConnection, id: string): Promise<Record<string, unknown> | null> {
  const { data } = await gql<{ collection?: Record<string, unknown> }>(
    conn,
    `query ActionCollection($id: ID!) { collection(id: $id) {
      id updatedAt title descriptionHtml handle sortOrder
      seo { title description }
      products(first: 100) { nodes { id } }
    } }`,
    { id },
  );
  return data?.collection ?? null;
}

function validateProductItems(raw: unknown): ProductPatch[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BATCH) return null;
  const items: ProductPatch[] = [];
  for (const value of raw) {
    const row = value as Record<string, unknown>;
    const productId = gid("Product", row.productId);
    if (!productId) return null;
    const item: ProductPatch = { productId };
    if (row.title !== undefined) item.title = cleanText(row.title, 255);
    if (row.descriptionHtml !== undefined) item.descriptionHtml = safeHtml(row.descriptionHtml);
    if (row.seoTitle !== undefined) item.seoTitle = cleanText(row.seoTitle, 70);
    if (row.seoDescription !== undefined) item.seoDescription = cleanText(row.seoDescription, 320);
    if (row.tags !== undefined) item.tags = stringList(row.tags, 250);
    if (row.vendor !== undefined) item.vendor = cleanText(row.vendor, 255);
    if (row.productType !== undefined) item.productType = cleanText(row.productType, 255);
    if (Array.isArray(row.mediaAlt)) {
      item.mediaAlt = row.mediaAlt.slice(0, 50).flatMap((entry) => {
        const media = entry as Record<string, unknown>;
        const id = gid("MediaImage", media.id);
        return id ? [{ id, alt: cleanText(media.alt, 512) }] : [];
      });
    }
    if (Object.keys(item).length === 1) return null;
    items.push(item);
  }
  return items;
}

function safeSourceUrl(raw: unknown): string {
  const value = cleanText(raw, 1_000);
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch { return ""; }
}

function validateSeoEvidence(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const keywords = Array.isArray(value.keywords) ? value.keywords.slice(0, 12).flatMap(entry => {
    const row = entry as Record<string, unknown>;
    const keyword = cleanText(row.keyword, 120);
    const evidence = cleanText(row.evidence, 500);
    const sourceUrl = safeSourceUrl(row.sourceUrl);
    return keyword && evidence && sourceUrl ? [{ keyword, evidence, sourceUrl }] : [];
  }) : [];
  const marketplace = Array.isArray(value.marketplace) ? value.marketplace.slice(0, 10).flatMap(entry => {
    const row = entry as Record<string, unknown>;
    const source = cleanText(row.source, 80);
    const observation = cleanText(row.observation, 600);
    const metric = cleanText(row.metric, 160);
    const sourceUrl = safeSourceUrl(row.sourceUrl);
    return source && observation && sourceUrl ? [{ source, observation, metric, sourceUrl }] : [];
  }) : [];
  const rationale = cleanText(value.rationale, 1_500);
  const limitations = cleanText(value.limitations, 800);
  const reviewRaw = value.review && typeof value.review === "object" ? value.review as Record<string,unknown> : {};
  const review = {
    currentListing: cleanText(reviewRaw.currentListing, 1_000),
    shopperIntent: cleanText(reviewRaw.shopperIntent, 1_000),
    keywordUse: cleanText(reviewRaw.keywordUse, 1_000),
    titleAdvice: cleanText(reviewRaw.titleAdvice, 1_000),
    descriptionAdvice: cleanText(reviewRaw.descriptionAdvice, 1_000),
    tagAdvice: cleanText(reviewRaw.tagAdvice, 1_000),
  };
  const geoRaw = value.geo && typeof value.geo === "object" ? value.geo as Record<string,unknown> : {};
  const geo = {
    label: cleanText(geoRaw.label, 120),
    improves: stringList(geoRaw.improves, 8),
    safeguards: stringList(geoRaw.safeguards, 8),
    manualGaps: stringList(geoRaw.manualGaps, 8),
  };
  const catalogRaw = value.catalogContext && typeof value.catalogContext === "object" ? value.catalogContext as Record<string,unknown> : {};
  const catalogContext = {
    category: cleanText(catalogRaw.category,240),
    existingTags: stringList(catalogRaw.existingTags,30),
    attributes: Array.isArray(catalogRaw.attributes) ? catalogRaw.attributes.slice(0,30).flatMap(entry=>{const row=entry as Record<string,unknown>;const label=cleanText(row.label,120),attributeValue=cleanText(row.value,500),source=row.source==="category"?"category":"product";return label&&attributeValue?[{label,value:attributeValue,source}]:[];}) : [],
  };
  return keywords.length || marketplace.length || rationale
    ? { keywords, marketplace, rationale, limitations, review, geo, catalogContext }
    : undefined;
}

function validateDiscount(raw: unknown, withCode: boolean): DiscountSpec | null {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const valueType = row.valueType;
  if (valueType !== "percentage" && valueType !== "fixed" && valueType !== "free_shipping") return null;
  const title = cleanText(row.title, 255);
  const code = withCode ? cleanText(row.code, 64).toUpperCase().replace(/[^A-Z0-9_-]/g, "") : undefined;
  const startsAt = cleanText(row.startsAt, 40);
  const endsAt = row.endsAt == null ? null : cleanText(row.endsAt, 40);
  const value = valueType === "free_shipping" ? undefined : Number(row.value);
  const minimumSubtotal = row.minimumSubtotal == null ? null : Number(row.minimumSubtotal);
  const usageLimit = row.usageLimit == null ? null : Math.round(Number(row.usageLimit));
  if (!title || (withCode && !code) || !Number.isFinite(Date.parse(startsAt))) return null;
  if (endsAt && (!Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) <= Date.parse(startsAt))) return null;
  if (valueType === "percentage" && (!value || value <= 0 || value > 50)) return null;
  if (valueType === "fixed" && (!value || value <= 0 || value > 100_000)) return null;
  if (minimumSubtotal !== null && (!Number.isFinite(minimumSubtotal) || minimumSubtotal < 0)) return null;
  if (usageLimit !== null && (!Number.isFinite(usageLimit) || usageLimit < 1 || usageLimit > 1_000_000)) return null;
  const productIds = stringList(row.productIds, 100).map((v) => gid("Product", v)).filter((v): v is string => Boolean(v));
  return {
    title,
    code,
    valueType,
    value,
    startsAt,
    endsAt,
    minimumSubtotal,
    usageLimit,
    appliesOncePerCustomer: row.appliesOncePerCustomer !== false,
    productIds,
  };
}

type AuthContext =
  | { error: Response }
  | { user: { id: string; email: string | null }; conn: ShopifyConnection };

async function authContext(authHeader: string | null, env: ShopifyEnv): Promise<AuthContext> {
  const user = await resolveUserFull(env, authHeader);
  if (!user) return { error: json(401, { error: "Sign in first." }) };
  if (!(await isOperator(env, user.id))) {
    return { error: json(OPERATOR_REQUIRED.status, { ...OPERATOR_REQUIRED.body }) };
  }
  const conn = await getConnection(env, user.id);
  if (!conn) return { error: json(409, { error: "Connect your Shopify store first." }) };
  return { user, conn };
}

function dbHeaders(env: ShopifyEnv, representation = false): Record<string, string> {
  return {
    apikey: env.serviceRoleKey ?? "",
    Authorization: `Bearer ${env.serviceRoleKey ?? ""}`,
    "Content-Type": "application/json",
    Prefer: representation ? "return=representation" : "return=minimal",
  };
}

async function event(env: ShopifyEnv, row: ShopifyActionRow, name: string, detail: Record<string, unknown> = {}) {
  if (!env.supabaseUrl || !env.serviceRoleKey) return;
  await fetch(`${env.supabaseUrl}/rest/v1/shopify_action_events`, {
    method: "POST",
    headers: dbHeaders(env),
    body: JSON.stringify({ action_id: row.id, user_id: row.user_id, event: name, detail }),
  }).catch(() => undefined);
}

async function updateAction(
  env: ShopifyEnv,
  id: string,
  userId: string,
  patch: Record<string, unknown>,
  onlyStatus?: ShopifyActionStatus,
): Promise<ShopifyActionRow | null> {
  const filter = `id=eq.${id}&user_id=eq.${userId}${onlyStatus ? `&status=eq.${onlyStatus}` : ""}`;
  const res = await fetch(`${env.supabaseUrl}/rest/v1/shopify_actions?${filter}&select=${ACTION_SELECT}`, {
    method: "PATCH",
    headers: dbHeaders(env, true),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) return null;
  return ((await res.json()) as ShopifyActionRow[])[0] ?? null;
}

async function loadAction(env: ShopifyEnv, id: string, userId: string): Promise<ShopifyActionRow | null> {
  const res = await fetch(
    `${env.supabaseUrl}/rest/v1/shopify_actions?id=eq.${id}&user_id=eq.${userId}&select=${ACTION_SELECT}&limit=1`,
    { headers: dbHeaders(env) },
  );
  return res.ok ? ((await res.json()) as ShopifyActionRow[])[0] ?? null : null;
}

export async function runActionPropose(body: ActionProposeBody, authHeader: string | null, env: ShopifyEnv): Promise<Response> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return json(503, { error: "Action storage isn't configured." });
  const ctx = await authContext(authHeader, env);
  if ("error" in ctx) return ctx.error;
  const kind = String(body.kind ?? "") as ShopifyActionKind;
  if (!["product_update", "product_draft_create", "collection_upsert", "discount_code_create", "discount_automatic_create"].includes(kind)) {
    return json(400, { error: "Unsupported action kind." });
  }

  let payload: Record<string, unknown>;
  let before: Record<string, unknown> = {};
  let summary = cleanText(body.summary, 500);
  let needsFiles = false;

  if (kind === "product_update") {
    const items = validateProductItems(body.items);
    if (!items) return json(400, { error: "Choose 1-10 valid product updates." });
    needsFiles = items.some((i) => Boolean(i.mediaAlt?.length));
    const states = await productStates(ctx.conn, items.map((i) => i.productId));
    if (!states) return json(502, { error: "Couldn't load every selected product from Shopify." });
    const evidence = validateSeoEvidence(body.evidence);
    payload = {
      items,
      ...(evidence ? { evidence } : {}),
      ...(cleanText(body.optimizerVersion, 80) ? { optimizerVersion: cleanText(body.optimizerVersion, 80) } : {}),
      ...(body.targetMarket && typeof body.targetMarket === "object" ? { targetMarket: body.targetMarket } : {}),
      ...(body.keywordPlan && typeof body.keywordPlan === "object" ? { keywordPlan: body.keywordPlan } : {}),
      ...(Array.isArray(body.sourceStatus) ? { sourceStatus: body.sourceStatus } : {}),
      ...(body.confirmedFacts && typeof body.confirmedFacts === "object" ? { confirmedFacts: body.confirmedFacts } : {}),
      ...(body.geoPlan && typeof body.geoPlan === "object" ? { geoPlan: body.geoPlan } : {}),
    };
    before = { products: states };
    summary ||= `Update ${items.length} product listing${items.length === 1 ? "" : "s"}`;
  } else if (kind === "product_draft_create") {
    const p = (body.product && typeof body.product === "object" ? body.product : {}) as Record<string, unknown>;
    const title = cleanText(p.title, 255);
    if (!title) return json(400, { error: "A draft product needs a title." });
    payload = {
      product: {
        title,
        descriptionHtml: safeHtml(p.descriptionHtml),
        vendor: cleanText(p.vendor, 255),
        productType: cleanText(p.productType, 255),
        tags: stringList(p.tags, 250),
      },
    };
    summary ||= `Create unpublished draft: ${title}`;
  } else if (kind === "collection_upsert") {
    const c = (body.collection && typeof body.collection === "object" ? body.collection : {}) as Record<string, unknown>;
    const id = c.id == null ? null : gid("Collection", c.id);
    const title = cleanText(c.title, 255);
    if (!title || (c.id != null && !id)) return json(400, { error: "Invalid collection proposal." });
    payload = {
      collection: {
        ...(id ? { id } : {}),
        title,
        descriptionHtml: safeHtml(c.descriptionHtml),
        handle: cleanText(c.handle, 255),
        sortOrder: cleanText(c.sortOrder, 50) || "MANUAL",
        seo: { title: cleanText((c.seo as Record<string, unknown>)?.title, 70), description: cleanText((c.seo as Record<string, unknown>)?.description, 320) },
        products: stringList(c.products, 100).map((v) => gid("Product", v)).filter(Boolean),
      },
    };
    if (id) {
      const state = await collectionState(ctx.conn, id);
      if (!state) return json(502, { error: "Couldn't load that collection from Shopify." });
      before = { collection: state };
    }
    summary ||= `${id ? "Update" : "Create"} collection: ${title}`;
  } else {
    const discount = validateDiscount(body.discount, kind === "discount_code_create");
    if (!discount) return json(400, { error: "Invalid or unsafe discount proposal." });
    payload = { discount };
    summary ||= `${kind === "discount_code_create" ? "Create code" : "Create automatic promotion"}: ${discount.title}`;
  }

  const missing = scopeError(ctx.conn, kind, needsFiles);
  if (missing) return json(409, { error: missing, reconnectRequired: true });

  const res = await fetch(`${env.supabaseUrl}/rest/v1/shopify_actions?select=${ACTION_SELECT}`, {
    method: "POST",
    headers: dbHeaders(env, true),
    body: JSON.stringify({ user_id: ctx.user.id, shop_domain: ctx.conn.shop_domain, kind, summary, payload, before_state: before }),
  });
  if (!res.ok) return json(502, { error: "Couldn't save the action proposal." });
  const row = ((await res.json()) as ShopifyActionRow[])[0];
  await event(env, row, "proposed");
  return json(201, { action: row });
}

async function preflight(row: ShopifyActionRow, conn: ShopifyConnection): Promise<boolean> {
  if (row.kind === "product_update") {
    const items = row.payload.items as ProductPatch[];
    const current = await productStates(conn, items.map((i) => i.productId));
    const before = row.before_state.products as ProductState[];
    return Boolean(current && before && current.every((p) => before.find((b) => b.id === p.id)?.updatedAt === p.updatedAt));
  }
  if (row.kind === "collection_upsert") {
    const collection = row.payload.collection as { id?: string };
    if (!collection.id) return true;
    const current = await collectionState(conn, collection.id);
    const before = row.before_state.collection as { updatedAt?: string } | undefined;
    return Boolean(current && before && current.updatedAt === before.updatedAt);
  }
  return true;
}

function productInput(item: ProductPatch): Record<string, unknown> {
  return {
    id: item.productId,
    ...(item.title !== undefined ? { title: item.title } : {}),
    ...(item.descriptionHtml !== undefined ? { descriptionHtml: item.descriptionHtml } : {}),
    ...(item.tags !== undefined ? { tags: item.tags } : {}),
    ...(item.vendor !== undefined ? { vendor: item.vendor } : {}),
    ...(item.productType !== undefined ? { productType: item.productType } : {}),
    ...(item.seoTitle !== undefined || item.seoDescription !== undefined
      ? { seo: { ...(item.seoTitle !== undefined ? { title: item.seoTitle } : {}), ...(item.seoDescription !== undefined ? { description: item.seoDescription } : {}) } }
      : {}),
  };
}

async function executeProducts(row: ShopifyActionRow, conn: ShopifyConnection) {
  const items = row.payload.items as ProductPatch[];
  const results: Record<string, unknown>[] = [];
  for (const item of items) {
    const { data, errors } = await gql<{
      productUpdate?: { product?: { id: string }; userErrors?: { message?: string }[] };
    }>(conn, `mutation ActionProductUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) { product { id } userErrors { field message } }
    }`, { product: productInput(item) });
    const userErrors = data?.productUpdate?.userErrors?.map((e) => e.message ?? "Product update failed.") ?? [];
    let allErrors = [...errors, ...userErrors];
    if (data?.productUpdate?.product?.id && item.mediaAlt?.length) {
      const media = await gql<{ fileUpdate?: { userErrors?: { message?: string }[] } }>(
        conn,
        `mutation ActionFileAlt($files: [FileUpdateInput!]!) { fileUpdate(files: $files) { files { id alt } userErrors { field message code } } }`,
        { files: item.mediaAlt },
      );
      allErrors = [...allErrors, ...media.errors, ...(media.data?.fileUpdate?.userErrors ?? []).map((e) => e.message ?? "Alt text update failed.")];
    }
    results.push({ productId: item.productId, ok: Boolean(data?.productUpdate?.product?.id) && allErrors.length === 0, errors: allErrors });
  }
  const after = await productStates(conn, items.map((i) => i.productId));
  return { results, after: { products: after ?? [] } };
}

async function executeDraft(row: ShopifyActionRow, conn: ShopifyConnection) {
  const source = row.payload.product as Record<string, unknown>;
  const product = { ...source, status: "DRAFT" };
  const { data, errors } = await gql<{
    productCreate?: { product?: { id: string; title: string; status: string; updatedAt: string }; userErrors?: { message?: string }[] };
  }>(conn, `mutation ActionProductCreate($product: ProductCreateInput!) {
    productCreate(product: $product) { product { id title status updatedAt } userErrors { field message } }
  }`, { product });
  const allErrors = [...errors, ...(data?.productCreate?.userErrors ?? []).map((e) => e.message ?? "Draft creation failed.")];
  return { results: [{ ok: Boolean(data?.productCreate?.product?.id) && allErrors.length === 0, product: data?.productCreate?.product, errors: allErrors }], after: { product: data?.productCreate?.product ?? null } };
}

async function executeCollection(row: ShopifyActionRow, conn: ShopifyConnection) {
  const collection = row.payload.collection as Record<string, unknown>;
  const updating = Boolean(collection.id);
  const mutation = updating
    ? `mutation ActionCollection($input: CollectionInput!) { collectionUpdate(input: $input) { collection { id updatedAt title } userErrors { field message } } }`
    : `mutation ActionCollection($input: CollectionInput!) { collectionCreate(input: $input) { collection { id updatedAt title } userErrors { field message } } }`;
  const key = updating ? "collectionUpdate" : "collectionCreate";
  const { data, errors } = await gql<Record<string, { collection?: { id: string; updatedAt: string; title: string }; userErrors?: { message?: string }[] }>>(
    conn, mutation, { input: collection },
  );
  const payload = data?.[key];
  const allErrors = [...errors, ...(payload?.userErrors ?? []).map((e) => e.message ?? "Collection change failed.")];
  return { results: [{ ok: Boolean(payload?.collection?.id) && allErrors.length === 0, collection: payload?.collection, errors: allErrors }], after: { collection: payload?.collection ?? null } };
}

function discountInput(spec: DiscountSpec, withCode: boolean): Record<string, unknown> {
  const items = spec.productIds?.length ? { products: { productsToAdd: spec.productIds } } : { all: true };
  const minimumRequirement = spec.minimumSubtotal != null
    ? { subtotal: { greaterThanOrEqualToSubtotal: String(spec.minimumSubtotal) } }
    : undefined;
  const base: Record<string, unknown> = {
    title: spec.title,
    ...(withCode ? { code: spec.code, customerSelection: { all: true } } : {}),
    startsAt: spec.startsAt,
    endsAt: spec.endsAt ?? null,
    ...(minimumRequirement ? { minimumRequirement } : {}),
    ...(withCode ? { appliesOncePerCustomer: spec.appliesOncePerCustomer, usageLimit: spec.usageLimit ?? null } : {}),
  };
  if (spec.valueType === "free_shipping") return { ...base, destination: { all: true } };
  return {
    ...base,
    customerGets: {
      value: spec.valueType === "percentage"
        ? { percentage: (spec.value ?? 0) / 100 }
        : { discountAmount: { amount: String(spec.value), appliesOnEachItem: false } },
      items,
    },
  };
}

async function executeDiscount(row: ShopifyActionRow, conn: ShopifyConnection) {
  const spec = row.payload.discount as unknown as DiscountSpec;
  const withCode = row.kind === "discount_code_create";
  const free = spec.valueType === "free_shipping";
  const field = withCode
    ? free ? "discountCodeFreeShippingCreate" : "discountCodeBasicCreate"
    : free ? "discountAutomaticFreeShippingCreate" : "discountAutomaticBasicCreate";
  const type = withCode
    ? free ? "DiscountCodeFreeShippingInput" : "DiscountCodeBasicInput"
    : free ? "DiscountAutomaticFreeShippingInput" : "DiscountAutomaticBasicInput";
  const arg = withCode ? (free ? "freeShippingCodeDiscount" : "basicCodeDiscount") : (free ? "freeShippingAutomaticDiscount" : "automaticBasicDiscount");
  const { data, errors } = await gql<Record<string, { codeDiscountNode?: { id: string }; automaticDiscountNode?: { id: string }; userErrors?: { message?: string }[] }>>(
    conn,
    `mutation ActionDiscount($input: ${type}!) { ${field}(${arg}: $input) {
      codeDiscountNode { id } automaticDiscountNode { id } userErrors { field message }
    } }`,
    { input: discountInput(spec, withCode) },
  );
  const result = data?.[field];
  const id = result?.codeDiscountNode?.id ?? result?.automaticDiscountNode?.id;
  const allErrors = [...errors, ...(result?.userErrors ?? []).map((e) => e.message ?? "Discount creation failed.")];
  return { results: [{ ok: Boolean(id) && allErrors.length === 0, discountId: id, code: spec.code, errors: allErrors }], after: { discountId: id ?? null, code: spec.code ?? null } };
}

export async function runActionExecute(actionIdRaw: unknown, authHeader: string | null, env: ShopifyEnv): Promise<Response> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return json(503, { error: "Action storage isn't configured." });
  const ctx = await authContext(authHeader, env);
  if ("error" in ctx) return ctx.error;
  const actionId = cleanText(actionIdRaw, 80);
  let row = await loadAction(env, actionId, ctx.user.id);
  if (!row) return json(404, { error: "Action not found." });
  if (row.status === "succeeded" || row.status === "partial") return json(200, { action: row });
  if (row.status !== "proposed") return json(409, { error: `Action is ${row.status}.`, action: row });
  if (Date.parse(row.expires_at) <= Date.now()) {
    row = (await updateAction(env, row.id, ctx.user.id, { status: "expired", error: "Proposal expired." }, "proposed")) ?? row;
    await event(env, row, "expired");
    return json(409, { error: "This proposal expired. Prepare it again.", action: row });
  }
  if (row.shop_domain !== ctx.conn.shop_domain) return json(409, { error: "This proposal belongs to another store." });
  const missing = scopeError(ctx.conn, row.kind, JSON.stringify(row.payload).includes("mediaAlt"));
  if (missing) return json(409, { error: missing, reconnectRequired: true });

  row = await updateAction(env, row.id, ctx.user.id, { status: "executing", approved_at: new Date().toISOString() }, "proposed");
  if (!row) return json(409, { error: "This action is already being processed." });
  await event(env, row, "approved");

  if (!(await preflight(row, ctx.conn))) {
    row = (await updateAction(env, row.id, ctx.user.id, { status: "stale", error: "Shopify changed after this proposal was prepared." }, "executing")) ?? row;
    await event(env, row, "stale");
    return json(409, { error: "Shopify changed since this preview. Prepare a fresh proposal.", action: row });
  }

  const execution = row.kind === "product_update"
    ? await executeProducts(row, ctx.conn)
    : row.kind === "product_draft_create"
      ? await executeDraft(row, ctx.conn)
      : row.kind === "collection_upsert"
        ? await executeCollection(row, ctx.conn)
        : await executeDiscount(row, ctx.conn);
  const succeeded = execution.results.filter((v) => v.ok).length;
  const status: ShopifyActionStatus = succeeded === execution.results.length ? "succeeded" : succeeded ? "partial" : "failed";
  const error = status === "succeeded" ? null : execution.results.flatMap((v) => v.errors as string[] ?? []).join("; ").slice(0, 1_000);
  row = (await updateAction(env, row.id, ctx.user.id, {
    status,
    result: { items: execution.results },
    after_state: execution.after,
    error,
    executed_at: new Date().toISOString(),
  }, "executing")) ?? row;
  await event(env, row, status, { succeeded, total: execution.results.length });
  log(status === "succeeded" ? "info" : "warn", "shopify-action", "executed", { actionId: row.id, kind: row.kind, status });
  return json(status === "failed" ? 502 : 200, { action: row });
}

export async function runActionUpdate(actionIdRaw: unknown, itemsRaw: unknown, authHeader: string | null, env: ShopifyEnv): Promise<Response> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return json(503, { error: "Action storage isn't configured." });
  const ctx = await authContext(authHeader, env);
  if ("error" in ctx) return ctx.error;
  const actionId = cleanText(actionIdRaw, 80);
  const row = await loadAction(env, actionId, ctx.user.id);
  if (!row) return json(404, { error: "That prepared update could not be found." });
  if (row.status !== "proposed") return json(409, { error: "Only updates waiting for approval can be edited." });
  if (row.kind !== "product_update") return json(400, { error: "This type of action cannot be edited here." });
  const items = validateProductItems(itemsRaw);
  if (!items) return json(400, { error: "The edited product details are incomplete or invalid." });
  const originalItems = row.payload.items as ProductPatch[];
  const originalIds = originalItems.map(item => item.productId).sort().join(",");
  const editedIds = items.map(item => item.productId).sort().join(",");
  if (originalIds !== editedIds) return json(400, { error: "Editing cannot change which Shopify products are targeted." });
  const payload = { ...row.payload, items };
  const response = await fetch(
    `${env.supabaseUrl}/rest/v1/shopify_actions?id=eq.${encodeURIComponent(row.id)}&user_id=eq.${encodeURIComponent(ctx.user.id)}&status=eq.proposed&select=${ACTION_SELECT}`,
    { method:"PATCH", headers:dbHeaders(env,true), body:JSON.stringify({payload}) },
  );
  if (!response.ok) return json(502, { error: "Couldn't save your edits." });
  const updated = ((await response.json()) as ShopifyActionRow[])[0];
  if (!updated) return json(409, { error: "This update changed before your edits could be saved. Refresh and try again." });
  await event(env, updated, "edited", { fields:"product listing" });
  return json(200, { action:updated });
}

export async function runActionReject(actionIdRaw: unknown, authHeader: string | null, env: ShopifyEnv): Promise<Response> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return json(503, { error: "Action storage isn't configured." });
  const ctx = await authContext(authHeader, env);
  if ("error" in ctx) return ctx.error;
  const actionId = cleanText(actionIdRaw, 80);
  const row = await loadAction(env, actionId, ctx.user.id);
  if (!row) return json(404, { error: "That prepared update could not be found." });
  if (row.status !== "proposed") return json(409, { error: "Only updates waiting for approval can be rejected." });
  const updated = await updateAction(env, row.id, ctx.user.id, { status:"rejected" }, "proposed");
  if (!updated) return json(409, { error: "This update changed before it could be rejected. Refresh and try again." });
  await event(env, updated, "rejected");
  return json(200, { action:updated });
}

async function undoMutation(row: ShopifyActionRow, conn: ShopifyConnection): Promise<{ ok: boolean; error?: string }> {
  if (row.kind === "product_update") {
    const before = row.before_state.products as ProductState[];
    for (const p of before) {
      const { data, errors } = await gql<{ productUpdate?: { product?: { id: string }; userErrors?: { message?: string }[] } }>(
        conn,
        `mutation UndoProduct($input: ProductUpdateInput!) { productUpdate(product: $input) { product { id } userErrors { field message } } }`,
        { input: { id: p.id, title: p.title, descriptionHtml: p.descriptionHtml, tags: p.tags, vendor: p.vendor, productType: p.productType, seo: p.seo } },
      );
      if (!data?.productUpdate?.product?.id || errors.length || data.productUpdate.userErrors?.length) return { ok: false, error: "A product could not be restored." };
      if (p.media.nodes.length) await gql(conn, `mutation UndoFiles($files: [FileUpdateInput!]!) { fileUpdate(files: $files) { files { id } userErrors { message } } }`, { files: p.media.nodes.map((m) => ({ id: m.id, alt: m.alt ?? "" })) });
    }
    return { ok: true };
  }
  if (row.kind === "product_draft_create") {
    const id = (row.after_state?.product as { id?: string } | undefined)?.id;
    if (!id) return { ok: false, error: "Created draft ID is missing." };
    const { data } = await gql<{ productUpdate?: { product?: { id: string } } }>(conn, `mutation ArchiveDraft($input: ProductUpdateInput!) { productUpdate(product: $input) { product { id } userErrors { message } } }`, { input: { id, status: "ARCHIVED" } });
    return data?.productUpdate?.product?.id ? { ok: true } : { ok: false, error: "Couldn't archive the draft." };
  }
  if (row.kind === "collection_upsert") {
    const before = row.before_state.collection as Record<string, unknown> | undefined;
    if (!before) return { ok: false, error: "New collections are not deleted automatically; archive them in Shopify." };
    const input = { id: before.id, title: before.title, descriptionHtml: before.descriptionHtml, handle: before.handle, sortOrder: before.sortOrder, seo: before.seo, products: ((before.products as { nodes?: { id: string }[] })?.nodes ?? []).map((p) => p.id) };
    const { data } = await gql<Record<string, { collection?: { id: string } }>>(conn, `mutation UndoCollection($input: CollectionInput!) { collectionUpdate(input: $input) { collection { id } userErrors { message } } }`, { input });
    return data?.collectionUpdate?.collection?.id ? { ok: true } : { ok: false, error: "Couldn't restore the collection." };
  }
  const id = row.after_state?.discountId;
  if (typeof id !== "string") return { ok: false, error: "Created discount ID is missing." };
  const field = row.kind === "discount_code_create" ? "discountCodeDeactivate" : "discountAutomaticDeactivate";
  const { data } = await gql<Record<string, { userErrors?: { message?: string }[] }>>(conn, `mutation UndoDiscount($id: ID!) { ${field}(id: $id) { userErrors { field message } } }`, { id });
  return data?.[field] && !data[field].userErrors?.length ? { ok: true } : { ok: false, error: "Couldn't deactivate the discount." };
}

async function undoPreflight(row: ShopifyActionRow, conn: ShopifyConnection): Promise<boolean> {
  if (row.kind === "product_update") {
    const applied = row.after_state?.products as ProductState[] | undefined;
    if (!applied?.length) return false;
    const current = await productStates(conn, applied.map((product) => product.id));
    return Boolean(current && current.every((product) => applied.find((saved) => saved.id === product.id)?.updatedAt === product.updatedAt));
  }
  if (row.kind === "product_draft_create") {
    const applied = row.after_state?.product as { id?: string; updatedAt?: string } | undefined;
    if (!applied?.id || !applied.updatedAt) return false;
    const current = await productStates(conn, [applied.id]);
    return Boolean(current?.[0] && current[0].updatedAt === applied.updatedAt && current[0].status === "DRAFT");
  }
  if (row.kind === "collection_upsert") {
    const before = row.before_state.collection as { id?: string } | undefined;
    if (!before?.id) return true;
    const applied = row.after_state?.collection as { id?: string; updatedAt?: string } | undefined;
    if (!applied?.id || !applied.updatedAt) return false;
    const current = await collectionState(conn, applied.id);
    return Boolean(current && current.updatedAt === applied.updatedAt);
  }
  return true;
}

export async function runActionUndo(actionIdRaw: unknown, authHeader: string | null, env: ShopifyEnv): Promise<Response> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return json(503, { error: "Action storage isn't configured." });
  const ctx = await authContext(authHeader, env);
  if ("error" in ctx) return ctx.error;
  const row = await loadAction(env, cleanText(actionIdRaw, 80), ctx.user.id);
  if (!row) return json(404, { error: "Action not found." });
  if (row.status !== "succeeded" && row.status !== "partial") return json(409, { error: "Only applied actions can be undone." });
  if (!row.executed_at || Date.now() - Date.parse(row.executed_at) > 86_400_000) return json(409, { error: "The 24-hour undo window has closed." });
  if (row.shop_domain !== ctx.conn.shop_domain) return json(409, { error: "This action belongs to another store." });
  if (!(await undoPreflight(row, ctx.conn))) {
    return json(409, { error: "Shopify changed after this action was applied. Undo it manually to avoid overwriting newer work." });
  }
  const result = await undoMutation(row, ctx.conn);
  if (!result.ok) return json(409, { error: result.error ?? "Undo failed." });
  const updated = (await updateAction(env, row.id, ctx.user.id, { status: "undone", undone_at: new Date().toISOString() })) ?? row;
  await event(env, updated, "undone");
  return json(200, { action: updated });
}

export async function runActionHistory(authHeader: string | null, env: ShopifyEnv): Promise<Response> {
  if (!env.supabaseUrl || !env.serviceRoleKey) return json(503, { error: "Action storage isn't configured." });
  const ctx = await authContext(authHeader, env);
  if ("error" in ctx) return ctx.error;
  const res = await fetch(
    `${env.supabaseUrl}/rest/v1/shopify_actions?user_id=eq.${ctx.user.id}&order=created_at.desc&limit=50&select=${ACTION_SELECT},shopify_action_metrics(window_days,metrics,measured_at)`,
    { headers: dbHeaders(env) },
  );
  if (!res.ok) return json(502, { error: "Couldn't load action history." });
  return json(200, { actions: await res.json() });
}

interface MetricOrder {
  createdAt?: string;
  totalPriceSet?: { shopMoney?: { amount?: string } };
  lineItems?: { nodes?: { quantity?: number; product?: { id?: string } | null }[] };
  discountApplications?: { nodes?: ({ code?: string; title?: string } | null)[] };
}

async function ordersForMetrics(conn: ShopifyConnection, from: Date, to: Date): Promise<MetricOrder[] | null> {
  const q = `created_at:>='${from.toISOString()}' AND created_at:<'${to.toISOString()}'`;
  const { data } = await gql<{ orders?: { nodes?: MetricOrder[] } }>(conn, `query ActionMetrics($q: String!) {
    orders(first: 250, query: $q, sortKey: CREATED_AT) { nodes {
      createdAt totalPriceSet { shopMoney { amount } }
      lineItems(first: 100) { nodes { quantity product { id } } }
      discountApplications(first: 20) { nodes {
        ... on DiscountCodeApplication { code }
        ... on AutomaticDiscountApplication { title }
      } }
    } }
  }`, { q });
  return data?.orders?.nodes ?? null;
}

function metricFor(row: ShopifyActionRow, before: MetricOrder[], after: MetricOrder[], days: number) {
  const sum = (orders: MetricOrder[]) => orders.reduce((n, o) => n + Number(o.totalPriceSet?.shopMoney?.amount ?? 0), 0);
  if (row.kind === "discount_code_create" || row.kind === "discount_automatic_create") {
    const spec = row.payload.discount as { code?: string; title?: string };
    const matches = (o: MetricOrder) => (o.discountApplications?.nodes ?? []).some((d) =>
      d && (spec.code ? d.code?.toUpperCase() === spec.code.toUpperCase() : d.title === spec.title));
    const attributed = after.filter(matches);
    return { windowDays: days, attribution: "exact_discount", orders: attributed.length, revenue: Math.round(sum(attributed) * 100) / 100, aov: attributed.length ? Math.round(sum(attributed) / attributed.length * 100) / 100 : 0 };
  }
  const ids = new Set<string>();
  if (row.kind === "product_update") for (const item of row.payload.items as { productId: string }[]) ids.add(item.productId);
  if (row.kind === "collection_upsert") for (const id of ((row.payload.collection as { products?: string[] }).products ?? [])) ids.add(id);
  if (row.kind === "product_draft_create") {
    const id = (row.after_state?.product as { id?: string } | undefined)?.id;
    if (id) ids.add(id);
  }
  const scoped = (orders: MetricOrder[]) => orders.flatMap((o) => {
    const units = (o.lineItems?.nodes ?? []).filter((li) => li.product?.id && ids.has(li.product.id)).reduce((n, li) => n + (li.quantity ?? 0), 0);
    return units ? [{ units, revenue: Number(o.totalPriceSet?.shopMoney?.amount ?? 0) }] : [];
  });
  const b = scoped(before), a = scoped(after);
  return {
    windowDays: days,
    attribution: "correlated_before_after",
    affectedProducts: ids.size,
    before: { orders: b.length, units: b.reduce((n, v) => n + v.units, 0), revenue: Math.round(b.reduce((n, v) => n + v.revenue, 0) * 100) / 100 },
    after: { orders: a.length, units: a.reduce((n, v) => n + v.units, 0), revenue: Math.round(a.reduce((n, v) => n + v.revenue, 0) * 100) / 100 },
  };
}

export async function runActionMetrics(authHeader: string | null, env: ActionEnv): Promise<Response> {
  if (!env.cronSecret || authHeader !== `Bearer ${env.cronSecret}`) return json(401, { error: "Unauthorized." });
  if (!env.supabaseUrl || !env.serviceRoleKey) return json(503, { error: "Action storage isn't configured." });
  const res = await fetch(`${env.supabaseUrl}/rest/v1/shopify_actions?status=in.(succeeded,partial)&executed_at=not.is.null&select=${ACTION_SELECT}&order=executed_at.asc`, { headers: dbHeaders(env) });
  if (!res.ok) return json(502, { error: "Couldn't load measurable actions." });
  const actions = await res.json() as ShopifyActionRow[];
  let measured = 0;
  for (const row of actions.slice(0, 50)) {
    const executed = new Date(row.executed_at!);
    const ageDays = (Date.now() - executed.getTime()) / 86_400_000;
    for (const days of [7, 14, 30]) {
      if (ageDays < days) continue;
      const exists = await fetch(`${env.supabaseUrl}/rest/v1/shopify_action_metrics?action_id=eq.${row.id}&window_days=eq.${days}&select=id&limit=1`, { headers: dbHeaders(env) });
      if (exists.ok && ((await exists.json()) as unknown[]).length) continue;
      const conn = await getConnection(env, row.user_id);
      if (!conn || conn.shop_domain !== row.shop_domain) continue;
      const [before, after] = await Promise.all([
        ordersForMetrics(conn, new Date(executed.getTime() - days * 86_400_000), executed),
        ordersForMetrics(conn, executed, new Date(executed.getTime() + days * 86_400_000)),
      ]);
      if (!before || !after) continue;
      const metrics = metricFor(row, before, after, days);
      const saved = await fetch(`${env.supabaseUrl}/rest/v1/shopify_action_metrics?on_conflict=action_id,window_days`, {
        method: "POST", headers: { ...dbHeaders(env), Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ action_id: row.id, user_id: row.user_id, window_days: days, metrics }),
      });
      if (saved.ok) measured++;
    }
  }
  return json(200, { ok: true, measured });
}
