import type { ExampleItem } from '../contracts/index';

/**
 * The module's UI surface (`@tria/module-example/ui`), and the shape every later module's component
 * should copy:
 *
 * - **Presentational only.** It fetches nothing and imports nothing from the kernel — the host page
 *   owns data loading and authorisation. `apps/web` may import a module's `ui` and nothing else
 *   (Biome blocks `@tria/core/server/*` and `@tria/core/db/*` from the web tier), and that rule is
 *   only enforceable because components stay dumb.
 * - **Authorisation arrives as a prop.** `canCreate` is computed from `bootstrap.permissions`
 *   server-side; the component never decides who may write, and the API re-checks it anyway.
 * - **Strings arrive as props.** All copy lives in the web app's pt-BR catalog, so a module ships no
 *   hard-coded language.
 */
export type ExampleWidgetProps = {
  items: ExampleItem[];
  canCreate: boolean;
  createAction?: (formData: FormData) => Promise<void>;
  labels: {
    title: string;
    empty: string;
    add: string;
    placeholder: string;
    processed: string;
  };
};

export function ExampleWidget({ items, canCreate, createAction, labels }: ExampleWidgetProps) {
  return (
    <section id="exemplo" aria-labelledby="exemplo-heading">
      <h2 id="exemplo-heading">{labels.title}</h2>

      {canCreate && createAction ? (
        <form action={createAction}>
          <label htmlFor="example-title">{labels.placeholder}</label>
          <input
            id="example-title"
            name="title"
            type="text"
            required
            maxLength={120}
            placeholder={labels.placeholder}
          />
          <button type="submit">{labels.add}</button>
        </form>
      ) : null}

      {items.length === 0 ? (
        <p>{labels.empty}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              {item.title}
              {item.processedAt ? <span> — {labels.processed}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
