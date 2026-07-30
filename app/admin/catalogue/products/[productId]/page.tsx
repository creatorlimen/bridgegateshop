import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  archiveProductFormAction,
  archiveVariantFormAction,
  createVariantFormAction,
  publishProductFormAction,
  updateProductFormAction,
  updateVariantFormAction,
} from '@/app/admin/catalogue/actions';
import { MediaUploadForm } from '@/app/admin/catalogue/products/[productId]/MediaUploadForm';
import { requireStaffPermission } from '@/lib/auth/authorization';
import { createCatalogueAdminRepository } from '@/lib/repositories/catalogue/CatalogueAdminRepository';
import { formatMoney } from '@/lib/utils/money/formatMoney';

export const metadata: Metadata = {
  title: 'Edit catalogue product',
  robots: {
    index: false,
    follow: false,
  },
};

type ProductAdminPageProps = {
  params: Promise<{
    productId: string;
  }>;
  searchParams: Promise<{
    notice?: string;
    error?: string;
    requestId?: string;
  }>;
};

const inputClassName =
  'min-h-12 rounded-xl border border-ink/15 bg-canvas px-4 text-sm outline-none focus:border-ink';
const textareaClassName =
  'min-h-28 rounded-xl border border-ink/15 bg-canvas px-4 py-3 text-sm outline-none focus:border-ink';

function koboToFormNaira(kobo: number | null) {
  return kobo === null ? '' : (kobo / 100).toFixed(2);
}

function ActionMessage({
  notice,
  error,
  requestId,
}: {
  notice?: string;
  error?: string;
  requestId?: string;
}) {
  if (!notice && !error) {
    return null;
  }

  return (
    <div
      className={
        error
          ? 'rounded-2xl border border-clay/20 bg-clay/10 p-5 text-sm'
          : 'rounded-2xl border border-moss/20 bg-moss/10 p-5 text-sm'
      }
      role={error ? 'alert' : 'status'}
    >
      <p className="font-black">{error ?? notice}</p>
      {error && requestId ? (
        <p className="mt-2 text-xs text-muted">
          Support reference: {requestId}
        </p>
      ) : null}
    </div>
  );
}

export default async function ProductAdminPage({
  params,
  searchParams,
}: ProductAdminPageProps) {
  const [{ productId }, resolvedSearchParams, staffContext] =
    await Promise.all([
      params,
      searchParams,
      requireStaffPermission('catalogue.read'),
    ]);
  const repository = createCatalogueAdminRepository();
  const [productDetail, categories] = await Promise.all([
    repository.getProductDetail(productId),
    repository.listCategories(),
  ]);

  if (!productDetail) {
    notFound();
  }

  const { product, variants, media } = productDetail;
  const canWrite = staffContext.permissions.has('catalogue.write');
  const canPublish = staffContext.permissions.has('catalogue.publish');
  const canPrice = staffContext.permissions.has('pricing.write');
  const isArchived = product.status === 'archived';

  return (
    <section>
      <Link
        className="text-sm font-black text-muted hover:text-ink"
        href="/admin/catalogue"
      >
        ← Back to catalogue
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow">{product.status} product</p>
          <h1 className="display-type mt-4 text-5xl sm:text-6xl">
            {product.name}
          </h1>
          <p className="mt-4 text-sm text-muted">
            /{product.slug} · version {product.version}
          </p>
        </div>
        {product.status === 'active' ||
        product.status === 'outOfStock' ? (
          <Link
            className="button-dark"
            href={`/products/${product.slug}`}
          >
            View product
          </Link>
        ) : null}
      </div>

      <div className="mt-8">
        <ActionMessage {...resolvedSearchParams} />
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
        <form
          action={updateProductFormAction}
          className="grid gap-5 rounded-[1.75rem] border border-ink/10 bg-paper p-6"
        >
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-clay">
              Product content
            </p>
            <h2 className="mt-2 text-2xl font-black">Public information</h2>
          </div>
          <input name="productId" type="hidden" value={product.id} />
          <input
            name="expectedVersion"
            type="hidden"
            value={product.version}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-xs font-black">
              Name
              <input
                className={inputClassName}
                defaultValue={product.name}
                disabled={!canWrite || isArchived}
                name="name"
                required
              />
            </label>
            <label className="grid gap-2 text-xs font-black">
              Slug
              <input
                className={inputClassName}
                defaultValue={product.slug}
                disabled={!canWrite || isArchived}
                name="slug"
                required
              />
            </label>
            <label className="grid gap-2 text-xs font-black">
              Category
              <select
                className={inputClassName}
                defaultValue={product.categoryId}
                disabled={!canWrite || isArchived}
                name="categoryId"
                required
              >
                {categories
                  .filter(
                    (category) =>
                      category.status !== 'archived' ||
                      category.id === product.categoryId,
                  )
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name} ({category.status})
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-2 text-xs font-black">
              Publication order
              <input
                className={inputClassName}
                defaultValue={product.publicationOrder}
                disabled={!canWrite || isArchived}
                min="0"
                name="publicationOrder"
                required
                type="number"
              />
            </label>
          </div>
          <label className="grid gap-2 text-xs font-black">
            Short description
            <textarea
              className={textareaClassName}
              defaultValue={product.shortDescription}
              disabled={!canWrite || isArchived}
              name="shortDescription"
              required
            />
          </label>
          <label className="grid gap-2 text-xs font-black">
            Full description
            <textarea
              className={`${textareaClassName} min-h-44`}
              defaultValue={product.description}
              disabled={!canWrite || isArchived}
              name="description"
              required
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-xs font-black">
              Specifications
              <textarea
                className={textareaClassName}
                defaultValue={product.specifications
                  .map(
                    (specification) =>
                      `${specification.label}: ${specification.value}`,
                  )
                  .join('\n')}
                disabled={!canWrite || isArchived}
                name="specifications"
              />
            </label>
            <label className="grid gap-2 text-xs font-black">
              Usage guidance
              <textarea
                className={textareaClassName}
                defaultValue={product.usageGuidance.join('\n')}
                disabled={!canWrite || isArchived}
                name="usageGuidance"
              />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-xs font-black">
              Search keywords
              <input
                className={inputClassName}
                defaultValue={product.searchKeywords.join(', ')}
                disabled={!canWrite || isArchived}
                name="searchKeywords"
              />
            </label>
            <label className="grid gap-2 text-xs font-black">
              Badge
              <input
                className={inputClassName}
                defaultValue={product.badge ?? ''}
                disabled={!canWrite || isArchived}
                name="badge"
              />
            </label>
            <label className="grid gap-2 text-xs font-black">
              Related mode
              <select
                className={inputClassName}
                defaultValue={product.relatedMode}
                disabled={!canWrite || isArchived}
                name="relatedMode"
              >
                <option value="category">Category</option>
                <option value="manual">Manual</option>
                <option value="combined">Combined</option>
              </select>
            </label>
            <label className="grid gap-2 text-xs font-black">
              Related product IDs
              <input
                className={inputClassName}
                defaultValue={product.relatedProductIds.join(', ')}
                disabled={!canWrite || isArchived}
                name="relatedProductIds"
              />
            </label>
          </div>
          <div className="grid gap-4 rounded-2xl bg-canvas p-5 sm:grid-cols-2">
            <label className="grid gap-2 text-xs font-black">
              Primary media
              <select
                className={inputClassName}
                defaultValue={product.primaryMediaId ?? ''}
                disabled={!canWrite || isArchived}
                name="primaryMediaId"
              >
                <option value="">Choose primary image</option>
                {media
                  .filter(
                    (mediaItem) =>
                      mediaItem.processingState === 'ready',
                  )
                  .map((mediaItem) => (
                    <option key={mediaItem.id} value={mediaItem.id}>
                      {mediaItem.altText}
                    </option>
                  ))}
              </select>
            </label>
            <label className="grid gap-2 text-xs font-black">
              Social image media ID
              <input
                className={inputClassName}
                defaultValue={product.seo.socialMediaId ?? ''}
                disabled={!canWrite || isArchived}
                name="socialMediaId"
              />
            </label>
            <label className="grid gap-2 text-xs font-black">
              SEO title
              <input
                className={inputClassName}
                defaultValue={product.seo.title ?? ''}
                disabled={!canWrite || isArchived}
                name="seoTitle"
              />
            </label>
            <label className="grid gap-2 text-xs font-black">
              Canonical URL
              <input
                className={inputClassName}
                defaultValue={product.seo.canonicalUrl ?? ''}
                disabled={!canWrite || isArchived}
                name="canonicalUrl"
                type="url"
              />
            </label>
            <label className="grid gap-2 text-xs font-black sm:col-span-2">
              SEO description
              <textarea
                className={textareaClassName}
                defaultValue={product.seo.description ?? ''}
                disabled={!canWrite || isArchived}
                name="seoDescription"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2 font-bold">
              <input
                defaultChecked={product.calculatorCompatible}
                disabled={!canWrite || isArchived}
                name="calculatorCompatible"
                type="checkbox"
              />
              Calculator compatible
            </label>
            <label className="flex items-center gap-2 font-bold">
              <input
                defaultChecked={product.featured}
                disabled={!canWrite || isArchived}
                name="featured"
                type="checkbox"
              />
              Featured
            </label>
          </div>
          {canWrite && !isArchived ? (
            <button className="button-primary" type="submit">
              Save product changes
            </button>
          ) : null}
        </form>

        <div className="grid content-start gap-8">
          <section className="rounded-[1.75rem] border border-ink/10 bg-paper p-6">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-clay">
              Publication gate
            </p>
            <dl className="mt-5 grid gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Ready media</dt>
                <dd className="font-black">
                  {
                    media.filter(
                      (mediaItem) =>
                        mediaItem.processingState === 'ready',
                    ).length
                  }
                  /3
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Active variants</dt>
                <dd className="font-black">
                  {
                    variants.filter(
                      (variant) => variant.status === 'active',
                    ).length
                  }
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Starting price</dt>
                <dd className="font-black">
                  {product.priceSummary.minimumPriceKobo > 0
                    ? formatMoney(
                        product.priceSummary.minimumPriceKobo,
                      )
                    : 'Pending'}
                </dd>
              </div>
            </dl>

            {canPublish && !isArchived ? (
              <form
                action={publishProductFormAction}
                className="mt-6 grid gap-3"
              >
                <input
                  name="productId"
                  type="hidden"
                  value={product.id}
                />
                <input
                  name="expectedVersion"
                  type="hidden"
                  value={product.version}
                />
                {staffContext.membership.roleIds.includes('owner') ? (
                  <label className="grid gap-2 text-xs font-black">
                    Owner media override reason
                    <textarea
                      className={textareaClassName}
                      name="mediaOverrideReason"
                      placeholder="Only required when publishing with fewer than three images"
                    />
                  </label>
                ) : null}
                <button className="button-primary" type="submit">
                  Publish product
                </button>
              </form>
            ) : null}
          </section>

          <section className="rounded-[1.75rem] border border-ink/10 bg-paper p-6">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-clay">
              Product media
            </p>
            <h2 className="mt-2 text-xl font-black">
              {media.length} uploaded images
            </h2>
            <div className="mt-5 grid gap-3">
              {media.map((mediaItem) => (
                <div
                  className="rounded-2xl bg-canvas p-4"
                  key={mediaItem.id}
                >
                  <p className="text-sm font-black">{mediaItem.altText}</p>
                  <p className="mt-1 text-xs text-muted">
                    {mediaItem.processingState} · {mediaItem.width}×
                    {mediaItem.height} · {Math.round(
                      mediaItem.bytes / 1024,
                    )}{' '}
                    KB
                  </p>
                </div>
              ))}
              {media.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-ink/20 p-5 text-sm text-muted">
                  No media uploaded yet. The controlled upload panel is
                  available below once Firebase Storage is configured.
                </p>
              ) : null}
            </div>
            {canWrite && !isArchived ? (
              <MediaUploadForm productId={product.id} />
            ) : null}
          </section>

          {canWrite && !isArchived ? (
            <form
              action={archiveProductFormAction}
              className="rounded-[1.75rem] border border-clay/20 bg-clay/5 p-6"
            >
              <h2 className="text-lg font-black text-clay">
                Archive product
              </h2>
              <p className="mt-2 text-xs leading-5 text-muted">
                Public visibility is removed. Historical snapshots and
                uniqueness claims remain intact.
              </p>
              <input
                name="productId"
                type="hidden"
                value={product.id}
              />
              <input
                name="expectedVersion"
                type="hidden"
                value={product.version}
              />
              <input
                className={`${inputClassName} mt-4 w-full`}
                name="reason"
                placeholder="Required archive reason"
                required
              />
              <button
                className="mt-3 rounded-full bg-clay px-5 py-3 text-xs font-black text-white"
                type="submit"
              >
                Archive product
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <section className="mt-8 rounded-[1.75rem] border border-ink/10 bg-paper p-6">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-clay">
          Variants and pricing
        </p>
        <h2 className="mt-2 text-2xl font-black">
          {variants.length} configured variants
        </h2>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {variants.map((variant) => (
            <article
              className="rounded-2xl border border-ink/10 bg-canvas p-5"
              key={variant.id}
            >
              <form action={updateVariantFormAction} className="grid gap-3">
                <input
                  name="productId"
                  type="hidden"
                  value={product.id}
                />
                <input
                  name="variantId"
                  type="hidden"
                  value={variant.id}
                />
                <input
                  name="expectedVersion"
                  type="hidden"
                  value={variant.version}
                />
                <div className="flex items-center justify-between gap-4">
                  <h3 className="font-black">{variant.name}</h3>
                  <span className="text-xs font-black uppercase">
                    {variant.status}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs font-black">
                    Name
                    <input
                      className={inputClassName}
                      defaultValue={variant.name}
                      disabled={!canWrite || !canPrice || isArchived}
                      name="name"
                      required
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-black">
                    SKU
                    <input
                      className={inputClassName}
                      defaultValue={variant.sku}
                      disabled={!canWrite || !canPrice || isArchived}
                      name="sku"
                      required
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-black">
                    Package label
                    <input
                      className={inputClassName}
                      defaultValue={variant.packageLabel}
                      disabled={!canWrite || !canPrice || isArchived}
                      name="packageLabel"
                      required
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-black">
                    Price (NGN)
                    <input
                      className={inputClassName}
                      defaultValue={koboToFormNaira(variant.priceKobo)}
                      disabled={!canWrite || !canPrice || isArchived}
                      min="0"
                      name="priceNaira"
                      required
                      step="0.01"
                      type="number"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-black">
                    Compare-at price
                    <input
                      className={inputClassName}
                      defaultValue={koboToFormNaira(
                        variant.compareAtPriceKobo,
                      )}
                      disabled={!canWrite || !canPrice || isArchived}
                      min="0"
                      name="compareAtPriceNaira"
                      step="0.01"
                      type="number"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-black">
                    Status
                    <select
                      className={inputClassName}
                      defaultValue={
                        variant.status === 'archived'
                          ? 'inactive'
                          : variant.status
                      }
                      disabled={
                        !canWrite ||
                        !canPrice ||
                        isArchived ||
                        variant.status === 'archived'
                      }
                      name="status"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-black">
                    Low-stock threshold
                    <input
                      className={inputClassName}
                      defaultValue={variant.lowStockThreshold}
                      disabled={!canWrite || !canPrice || isArchived}
                      min="0"
                      name="lowStockThreshold"
                      required
                      type="number"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-black">
                    Publication order
                    <input
                      className={inputClassName}
                      defaultValue={variant.publicationOrder}
                      disabled={!canWrite || !canPrice || isArchived}
                      min="0"
                      name="publicationOrder"
                      required
                      type="number"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-black">
                    Coverage m²
                    <input
                      className={inputClassName}
                      defaultValue={
                        variant.coverageRate?.areaSquareMetres ?? ''
                      }
                      disabled={!canWrite || !canPrice || isArchived}
                      min="0.01"
                      name="coverageAreaSquareMetres"
                      step="0.01"
                      type="number"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-black">
                    Coverage per units
                    <input
                      className={inputClassName}
                      defaultValue={variant.coverageRate?.perUnits ?? ''}
                      disabled={!canWrite || !canPrice || isArchived}
                      min="1"
                      name="coveragePerUnits"
                      type="number"
                    />
                  </label>
                </div>
                <input
                  name="coverageAssumptions"
                  type="hidden"
                  value={variant.coverageRate?.assumptions ?? ''}
                />
                <input
                  name="coverageRevision"
                  type="hidden"
                  value={variant.coverageRate?.revision ?? 1}
                />
                <input
                  name="optionValues"
                  type="hidden"
                  value={Object.entries(variant.optionValues)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\n')}
                />
                <input
                  name="weightGrams"
                  type="hidden"
                  value={variant.weightGrams ?? ''}
                />
                <label className="flex items-center gap-2 text-xs font-black">
                  <input
                    defaultChecked={variant.stockManaged}
                    disabled={!canWrite || !canPrice || isArchived}
                    name="stockManaged"
                    type="checkbox"
                  />
                  Inventory-managed
                </label>
                {canWrite &&
                canPrice &&
                !isArchived &&
                variant.status !== 'archived' ? (
                  <button className="button-dark" type="submit">
                    Update variant
                  </button>
                ) : null}
              </form>

              {canWrite &&
              canPrice &&
              !isArchived &&
              variant.status !== 'archived' ? (
                <form
                  action={archiveVariantFormAction}
                  className="mt-3 flex gap-2"
                >
                  <input
                    name="productId"
                    type="hidden"
                    value={product.id}
                  />
                  <input
                    name="variantId"
                    type="hidden"
                    value={variant.id}
                  />
                  <input
                    name="expectedVersion"
                    type="hidden"
                    value={variant.version}
                  />
                  <input
                    className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-paper px-3 text-xs"
                    name="reason"
                    placeholder="Archive reason"
                    required
                  />
                  <button
                    className="rounded-xl border border-clay/30 px-3 py-2 text-xs font-black text-clay"
                    type="submit"
                  >
                    Archive
                  </button>
                </form>
              ) : null}
            </article>
          ))}
        </div>

        {canWrite && canPrice && !isArchived ? (
          <form
            action={createVariantFormAction}
            className="mt-7 grid gap-4 border-t border-ink/10 pt-7"
          >
            <h3 className="text-lg font-black">Add product variant</h3>
            <input name="productId" type="hidden" value={product.id} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-2 text-xs font-black">
                Name
                <input className={inputClassName} name="name" required />
              </label>
              <label className="grid gap-2 text-xs font-black">
                SKU
                <input className={inputClassName} name="sku" required />
              </label>
              <label className="grid gap-2 text-xs font-black">
                Package label
                <input
                  className={inputClassName}
                  name="packageLabel"
                  required
                />
              </label>
              <label className="grid gap-2 text-xs font-black">
                Price (NGN)
                <input
                  className={inputClassName}
                  min="0"
                  name="priceNaira"
                  required
                  step="0.01"
                  type="number"
                />
              </label>
              <label className="grid gap-2 text-xs font-black">
                Compare-at price
                <input
                  className={inputClassName}
                  min="0"
                  name="compareAtPriceNaira"
                  step="0.01"
                  type="number"
                />
              </label>
              <label className="grid gap-2 text-xs font-black">
                Status
                <select
                  className={inputClassName}
                  defaultValue="active"
                  name="status"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <label className="grid gap-2 text-xs font-black">
                Low-stock threshold
                <input
                  className={inputClassName}
                  defaultValue="5"
                  min="0"
                  name="lowStockThreshold"
                  required
                  type="number"
                />
              </label>
              <label className="grid gap-2 text-xs font-black">
                Publication order
                <input
                  className={inputClassName}
                  defaultValue="10"
                  min="0"
                  name="publicationOrder"
                  required
                  type="number"
                />
              </label>
              <label className="grid gap-2 text-xs font-black">
                Coverage m²
                <input
                  className={inputClassName}
                  min="0.01"
                  name="coverageAreaSquareMetres"
                  step="0.01"
                  type="number"
                />
              </label>
              <label className="grid gap-2 text-xs font-black">
                Coverage per units
                <input
                  className={inputClassName}
                  defaultValue="1"
                  min="1"
                  name="coveragePerUnits"
                  type="number"
                />
              </label>
              <label className="grid gap-2 text-xs font-black lg:col-span-2">
                Coverage assumptions
                <input
                  className={inputClassName}
                  name="coverageAssumptions"
                />
              </label>
            </div>
            <input name="coverageRevision" type="hidden" value="1" />
            <input name="optionValues" type="hidden" value="" />
            <input name="weightGrams" type="hidden" value="" />
            <label className="flex items-center gap-2 text-sm font-bold">
              <input defaultChecked name="stockManaged" type="checkbox" />
              Inventory-managed
            </label>
            <button className="button-primary" type="submit">
              Add variant
            </button>
          </form>
        ) : null}
      </section>
    </section>
  );
}
