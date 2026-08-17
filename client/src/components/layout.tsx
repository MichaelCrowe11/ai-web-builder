import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LayoutTemplate, CreditCard, Menu } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { AuthModal } from "@/components/auth/auth-modal";
import { AiwbMark } from "@/components/brand/aiwb-mark";

type LayoutVariant = "editorial" | "console";

export function Layout({
  children,
  variant = "editorial",
}: {
  children: React.ReactNode;
  variant?: LayoutVariant;
}) {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, logout } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const editorial = variant === "editorial";

  const openAuth = (mode: "login" | "register") => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  const navItems = [
    { label: "Builder", href: "/builder", icon: LayoutTemplate },
    { label: "Pricing", href: "/pricing", icon: CreditCard },
  ];

  const navClass = (active: boolean) =>
    `cursor-pointer text-sm font-medium transition-colors duration-100 ${
      active
        ? "text-accent"
        : editorial
          ? "text-warm-dim hover:text-ink"
          : "text-parchment-dim hover:text-parchment"
    }`;

  return (
    <div
      className={`flex min-h-screen flex-col font-sans ${
        editorial ? "bg-paper text-ink" : "bg-graphite text-parchment"
      }`}
    >
      <div aria-hidden className="grain" />
      <header
        className={`sticky top-0 z-50 border-b backdrop-blur-xl backdrop-saturate-150 ${
          editorial
            ? "border-paper-line bg-paper/85"
            : "border-white/[0.06] bg-graphite/70"
        }`}
      >
        <div className="container mx-auto flex h-[72px] max-w-6xl items-center justify-between px-6">
          <Link href="/">
            <div className="group flex cursor-pointer items-center gap-3">
              <AiwbMark
                size={27}
                className={`transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-[1.05] motion-reduce:transition-none ${
                  editorial ? "text-ink" : "text-parchment"
                }`}
              />
              <div className="flex items-baseline gap-3">
                <span
                  className={`font-display text-[1.35rem] font-medium leading-none tracking-[-0.015em] ${
                    editorial ? "text-ink" : "text-parchment"
                  }`}
                >
                  Web Builder
                </span>
                <span
                  className={`hidden border-l pl-3 font-mono text-[0.58rem] uppercase tracking-[0.2em] sm:inline ${
                    editorial
                      ? "border-paper-line text-warm-dim"
                      : "border-white/10 text-parchment/40"
                  }`}
                >
                  by Crowe Logic
                </span>
              </div>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 md:flex">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <span className={navClass(location === item.href)}>{item.label}</span>
              </Link>
            ))}
            <div
              className={`mx-1 h-4 w-px ${
                editorial ? "bg-paper-line" : "bg-white/10"
              }`}
            />
            {user ? (
              <>
                <span
                  className={`flex items-center gap-2 text-sm ${
                    editorial ? "text-warm-dim" : "text-parchment-dim"
                  }`}
                >
                  {user.username}
                  {user.plan === "pro" && (
                    <span className="border border-accent/35 px-1.5 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-accent">
                      Pro
                    </span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className={editorial ? "text-ink hover:bg-ink/5" : ""}
                  onClick={() => logout()}
                >
                  Log out
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className={editorial ? "text-ink hover:bg-ink/5" : ""}
                  onClick={() => openAuth("login")}
                >
                  Log in
                </Button>
                <Button
                  size="sm"
                  className={
                    editorial
                      ? "rounded-md bg-ink px-4 text-paper hover:bg-ink/90"
                      : "rounded-md bg-accent px-4 text-on-accent hover:bg-accent/90"
                  }
                  onClick={() => openAuth("register")}
                >
                  Start building
                </Button>
              </>
            )}
          </nav>

          <div className="md:hidden">
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={editorial ? "text-ink hover:bg-ink/5" : ""}
                  aria-label="Open navigation"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                className={
                  editorial
                    ? "border-paper-line bg-paper text-ink"
                    : "border-white/10 bg-graphite-soft text-parchment"
                }
              >
                <div className="mt-10 flex flex-col gap-5">
                  {navItems.map((item) => (
                    <Link key={item.href} href={item.href}>
                      <span
                        className={`flex cursor-pointer items-center gap-3 font-display text-2xl transition-colors ${
                          location === item.href
                            ? "text-accent"
                            : editorial
                              ? "text-ink"
                              : "text-parchment"
                        }`}
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </span>
                    </Link>
                  ))}
                  <div
                    className={`my-2 h-px ${
                      editorial ? "bg-paper-line" : "bg-white/10"
                    }`}
                  />
                  {user ? (
                    <Button
                      variant="outline"
                      className={
                        editorial
                          ? "w-full border-ink/20 bg-transparent text-ink"
                          : "w-full"
                      }
                      onClick={() => {
                        logout();
                        setIsMobileMenuOpen(false);
                      }}
                    >
                      Log out ({user.username})
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        className={
                          editorial
                            ? "w-full border-ink/20 bg-transparent text-ink"
                            : "w-full"
                        }
                        onClick={() => {
                          openAuth("login");
                          setIsMobileMenuOpen(false);
                        }}
                      >
                        Log in
                      </Button>
                      <Button
                        className={
                          editorial
                            ? "w-full bg-ink text-paper hover:bg-ink/90"
                            : "w-full bg-accent text-on-accent"
                        }
                        onClick={() => {
                          openAuth("register");
                          setIsMobileMenuOpen(false);
                        }}
                      >
                        Start building
                      </Button>
                    </>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-white/[0.08] bg-[#11100e] pb-8 pt-14 text-parchment">
        <div className="container mx-auto grid max-w-6xl gap-10 px-6 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <div className="mb-5 flex items-center gap-3">
              <AiwbMark size={24} className="text-parchment" />
              <span className="font-display text-xl font-medium leading-none tracking-[-0.01em]">
                Web Builder
              </span>
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-parchment/55">
              Describe the business. Get a finished website. Keep improving it
              after launch.
            </p>
          </div>
          <div>
            <h4 className="mb-4 font-mono text-[0.62rem] uppercase tracking-[0.22em] text-accent">
              Product
            </h4>
            <ul className="space-y-2.5 text-sm text-parchment/55">
              <li>
                <a href="/#how-it-works" className="transition-colors hover:text-parchment">
                  How it works
                </a>
              </li>
              <li>
                <Link href="/pricing" className="transition-colors hover:text-parchment">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/builder" className="transition-colors hover:text-parchment">
                  Start building
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 font-mono text-[0.62rem] uppercase tracking-[0.22em] text-accent">
              Agents
            </h4>
            <ul className="space-y-2.5 text-sm text-parchment/55">
              <li>
                <a href="/llms.txt" className="transition-colors hover:text-parchment">
                  llms.txt
                </a>
              </li>
              <li>
                <a href="/mcp" className="transition-colors hover:text-parchment">
                  MCP endpoint
                </a>
              </li>
              <li>
                <Link href="/api-keys" className="transition-colors hover:text-parchment">
                  API keys
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 font-mono text-[0.62rem] uppercase tracking-[0.22em] text-accent">
              Legal
            </h4>
            <ul className="space-y-2.5 text-sm text-parchment/55">
              <li>
                <Link href="/privacy" className="transition-colors hover:text-parchment">
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="transition-colors hover:text-parchment">
                  Terms
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="container mx-auto mt-12 flex max-w-6xl flex-col items-start gap-5 border-t border-white/[0.08] px-6 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <a
            href="https://www.crowelogic.com"
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-3"
          >
            <span className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-accent">
              A product of
            </span>
            <img
              src="/brand/crowe-logic-wordmark.svg"
              alt="Crowe Logic"
              width={112}
              height={26}
              className="w-[112px] opacity-80 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none"
            />
          </a>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-parchment/30">
            Crowe Logic Inc.
          </p>
        </div>
      </footer>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultMode={authMode} />
    </div>
  );
}
