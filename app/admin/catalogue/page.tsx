import type { Metadata } from 'next';
import Link from 'next/link';

import {
  activateCategoryFormAction,
  archiveCategoryFormAction,
  createCategoryFormAction,
  createProductFormAction,
} from '@/app/admin/catalogue/actions';
import { requireStaffPermission } from '@/lib/auth/authorization';
import { CategoryEditForm } from '@/app/admin/catalogue/CategoryEditForm';
import { createCatalogueAdminRepository } from '@/lib/repositories/catalogue/CatalogueAdminRepository';
import { formatMoney } from '@/lib/utils/money/formatMoney';

export const metadata: Metadata = {
  title: 'Catalogue administration',
  robots: {
    index: false,
    follow: false,
  },
};

type CatalogueAdminPageProps = {
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
          ? 'mb-8 rounded-2xl border border-clay/20 bg-clay/10 p-5 text-sm'
          : 'mb-8 rounded-2xl border border-moss/20 bg-moss/10 p-5 text-sm'
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

export default async function CatalogueAdminPage({
  searchParams,
}: CatalogueAdminPageProps) {
  const [staffContext, resolvedSearchParams] = await Promise.all([
    requireStaffPermission('catalogue.read'),
    searchParams,
  ]);
  const repository = createCatalogueAdminRepository();
  const [categories, products] = await Promise.all([
    repository.listCategories(),
    repository.listProducts(),
  ]);
  const canWrite = staffContext.permissions.has('catalogue.write');
  const canPublish = staffContext.permissions.has('catalogue.publish');
  const canPrice = staffContext.permissions.has('pricing.write');
  const editableCategories = categories.filter(
    (category) => category.status !== 'archived',
  );

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow">Catalogue operations</p>
          <h1 className="display-type mt-4 text-5xl sm:text-6xl">
            Products and categories
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-muted">
            Draft safely, add variants and media, then publish through
            server-validated workflows.
          </p>
        </div>
        <Link className="button-dark" href="/shop">
          View public shop
        </Link>
      </div>

      <div className="mt-8">
        <ActionMessage {...resolvedSearchParams} />
      </div>

      <div className="grid gap-8 xl:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-[1.75rem] border border-ink/10 bg-paper p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-clay">
                Categories
              </p>
              <h2 className="mt-2 text-2xl font-black">
                {categories.length} configured
              </h2>
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            {categories.map((category) => (
              <article
                className="rounded-2xl border border-ink/10 bg-canvas p-4"
                key={category.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-black">{category.name}</h3>
                    <p className="mt-1 text-xs text-muted">
                      /{category.slug} · order {category.displayOrder} · v
                      {category.version}
                    </p>
                  </div>
                  <span className="rounded-full bg-ink/8 px-3 py-1 text-[0.65rem] font-black uppercase tracking-[0.1em]">
                    {category.status}
                  </span>
                </div>

                {category.status !== 'archived' && canWrite ? (
                  <CategoryEditForm category={category} />
                ) : null}
                {category.status === 'draft' && canPublish ? (
                  <form action={activateCategoryFormAction} className="mt-4">
                    <input
                      name="categoryId"
                      type="hidden"
                      value={category.id}
                    />
                    <input
                      name="expectedVersion"
                      type="hidden"
                      value={category.version}
                    />
                    <button
                      className="rounded-full bg-moss px-4 py-2 text-xs font-black text-white"
                      type="submit"
                    >
                      Activate
                    </button>
                  </form>
                ) : null}

                {category.status !== 'archived' && canWrite ? (
                  <form
                    action={archiveCategoryFormAction}
                    className="mt-3 flex gap-2"
                  >
                    <input
                      name="categoryId"
                      type="hidden"
                      value={category.id}
                    />
                    <input
                      name="expectedVersion"
                      type="hidden"
                      value={category.version}
                    />
                    <input
                      aria-label={`Reason for archiving ${category.name}`}
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

          {canWrite ? (
            <form
              action={createCategoryFormAction}
              className="mt-7 grid gap-4 border-t border-ink/10 pt-7"
            >
              <h3 className="text-lg font-black">Create category draft</h3>
              <label className="grid gap-2 text-xs font-black">
                Name
                <input className={inputClassName} name="name" required />
              </label>
              <label className="grid gap-2 text-xs font-black">
                Slug
                <input
                  className={inputClassName}
                  name="slug"
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  placeholder="product-category"
                  required
                />
              </label>
              <label className="grid gap-2 text-xs font-black">
                Description
                <textarea
                  className={textareaClassName}
                  name="description"
                  required
                />
              </label>
              <label className="grid gap-2 text-xs font-black">
                Display order
                <input
                  className={inputClassName}
                  defaultValue="10"
                  min="0"
                  name="displayOrder"
                  required
                  type="number"
                />
              </label>
              <label className="grid gap-2 text-xs font-black">
                Search keywords
                <input
                  className={inputClassName}
                  name="searchKeywords"
                  placeholder="paint, finish, ceiling"
                />
              </label>
              <button className="button-primary" type="submit">
                Save category draft
              </button>
            </form>
          ) : null}
        </section>

        <section className="rounded-[1.75rem] border border-ink/10 bg-paper p-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-clay">
              Products
            </p>
            <h2 className="mt-2 text-2xl font-black">
              {products.length} configured
            </h2>
          </div>

          <div className="mt-6 grid gap-3">
            {products.map((product) => (
              <Link
                className="rounded-2xl border border-ink/10 bg-canvas p-5 transition hover:border-ink"
                href={`/admin/catalogue/products/${product.id}`}
                key={product.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="font-black">{product.name}</h3>
                    <p className="mt-1 text-xs text-muted">
                      /{product.slug} · {product.availabilitySummary.activeVariantCount}{' '}
                      active variants · v{product.version}
                    </p>
                    <p className="mt-3 text-sm font-black">
                      {product.priceSummary.maximumPriceKobo > 0
                        ? formatMoney(
                            product.priceSummary.minimumPriceKobo,
                          )
                        : 'Price pending'}
                    </p>
                  </div>
                  <span className="rounded-full bg-ink/8 px-3 py-1 text-[0.65rem] font-black uppercase tracking-[0.1em]">
                    {product.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {canWrite && canPrice ? (
            <form
              action={createProductFormAction}
              className="mt-7 grid gap-4 border-t border-ink/10 pt-7"
            >
              <h3 className="text-lg font-black">Create product draft</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-xs font-black">
                  Name
                  <input className={inputClassName} name="name" required />
                </label>
                <label className="grid gap-2 text-xs font-black">
                  Slug
                  <input
                    className={inputClassName}
                    name="slug"
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    required
                  />
                </label>
                <label className="grid gap-2 text-xs font-black">
                  Category
                  <select
                    className={inputClassName}
                    name="categoryId"
                    required
                  >
                    <option value="">Choose category</option>
                    {editableCategories.map((category) => (
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
                    defaultValue="10"
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
                  name="shortDescription"
                  required
                />
              </label>
              <label className="grid gap-2 text-xs font-black">
                Full description
                <textarea
                  className={`${textareaClassName} min-h-40`}
                  name="description"
                  required
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-xs font-black">
                  Specifications
                  <textarea
                    className={textareaClassName}
                    name="specifications"
                    placeholder={'Finish: Matt\nPack: 20 litres'}
                  />
                </label>
                <label className="grid gap-2 text-xs font-black">
                  Usage guidance
                  <textarea
                    className={textareaClassName}
                    name="usageGuidance"
                    placeholder="One instruction per line"
                  />
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-xs font-black">
                  Search keywords
                  <input
                    className={inputClassName}
                    name="searchKeywords"
                    placeholder="paint, pop, ceiling"
                  />
                </label>
                <label className="grid gap-2 text-xs font-black">
                  Badge
                  <input className={inputClassName} name="badge" />
                </label>
              </div>
              <input name="relatedMode" type="hidden" value="category" />
              <div className="flex flex-wrap gap-5 text-sm">
                <label className="flex items-center gap-2 font-bold">
                  <input name="calculatorCompatible" type="checkbox" />
                  Calculator compatible
                </label>
                <label className="flex items-center gap-2 font-bold">
                  <input name="featured" type="checkbox" />
                  Featured
                </label>
              </div>
              <button className="button-primary" type="submit">
                Save product draft
              </button>
            </form>
          ) : (
            <p className="mt-7 rounded-2xl bg-amber/15 p-4 text-sm leading-6 text-muted">
              Product creation requires both catalogue and pricing
              permissions.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
