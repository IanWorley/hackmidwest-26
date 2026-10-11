import {
  createRootRoute,
  HeadContent,
  Link,
  type LinkProps,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { JSX } from "react";
import { APP_NAME } from "@/lib/page-title";
import styles from "@/styles.css?url";

const NAV_ITEMS = [
  { to: "/conditions", label: "Conditions" },
  { to: "/facilities", label: "Facilities" },
] as const satisfies readonly { to: LinkProps["to"]; label: string }[];

function RootDocument(): JSX.Element {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header className="border-b">
          <nav
            aria-label="Main"
            className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3"
          >
            <Link className="font-heading font-semibold" to="/">
              {APP_NAME}
            </Link>
            {NAV_ITEMS.map(({ to, label }) => (
              <Link
                className="text-muted-foreground text-sm hover:text-foreground aria-[current=page]:text-foreground"
                key={to}
                to={to}
              >
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">
          <Outlet />
        </main>
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
    ],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  component: RootDocument,
});
