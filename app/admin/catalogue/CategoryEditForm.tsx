import { updateCategoryFormAction } from '@/app/admin/catalogue/actions';
import type { CategoryRecord } from '@/lib/schemas/catalogue';

const inputClassName =
  'min-h-11 rounded-xl border border-ink/15 bg-paper px-3 text-xs outline-none focus:border-ink';
const textareaClassName =
  'min-h-24 rounded-xl border border-ink/15 bg-paper px-3 py-2 text-xs outline-none focus:border-ink';

export function CategoryEditForm({
  category,
}: {
  category: CategoryRecord;
}) {
  return (
    <details className="mt-4 rounded-xl border border-ink/10 bg-paper p-3">
      <summary className="cursor-pointer text-xs font-black">
        Edit category
      </summary>
      <form
        action={updateCategoryFormAction}
        className="mt-4 grid gap-3"
      >
        <input name="categoryId" type="hidden" value={category.id} />
        <input
          name="expectedVersion"
          type="hidden"
          value={category.version}
        />
        <label className="grid gap-1 text-xs font-black">
          Name
          <input
            className={inputClassName}
            defaultValue={category.name}
            name="name"
            required
          />
        </label>
        <label className="grid gap-1 text-xs font-black">
          Slug
          <input
            className={inputClassName}
            defaultValue={category.slug}
            name="slug"
            required
          />
        </label>
        <label className="grid gap-1 text-xs font-black">
          Description
          <textarea
            className={textareaClassName}
            defaultValue={category.description}
            name="description"
            required
          />
        </label>
        <label className="grid gap-1 text-xs font-black">
          Display order
          <input
            className={inputClassName}
            defaultValue={category.displayOrder}
            min="0"
            name="displayOrder"
            required
            type="number"
          />
        </label>
        <label className="grid gap-1 text-xs font-black">
          Search keywords
          <input
            className={inputClassName}
            defaultValue={category.searchKeywords.join(', ')}
            name="searchKeywords"
          />
        </label>
        <input
          name="imageMediaId"
          type="hidden"
          value={category.imageMediaId ?? ''}
        />
        <input
          name="seoTitle"
          type="hidden"
          value={category.seo.title ?? ''}
        />
        <input
          name="seoDescription"
          type="hidden"
          value={category.seo.description ?? ''}
        />
        <input
          name="canonicalUrl"
          type="hidden"
          value={category.seo.canonicalUrl ?? ''}
        />
        <input
          name="socialMediaId"
          type="hidden"
          value={category.seo.socialMediaId ?? ''}
        />
        <button
          className="rounded-full bg-ink px-4 py-2 text-xs font-black text-white"
          type="submit"
        >
          Save category
        </button>
      </form>
    </details>
  );
}
