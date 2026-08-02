import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LayoutTemplate, CreditCard, Menu } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { AuthModal } from "@/components/auth/auth-modal";
import { CroweMark } from "@/components/brand/crowe-mark";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, logout } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");

  const openAuth = (mode: "login" | "register") => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  const navItems = [
    { label: "Builder", href: "/builder", icon: LayoutTemplate },
    { label: "Pricing", href: "/pricing", icon: CreditCard },
  ];

  const navClass = (active: boolean) =>
    `text-sm font-medium transition-colors cursor-pointer hover:text-gold ${active ? "text-gold" : "text-parchment-dim"}`;

  return (
    <div className="min-h-screen bg-graphite text-parchment flex flex-col font-sans">
      <header className="border-b border-gold/15 bg-graphite/95 backdrop-blur supports-[backdrop-filter]:bg-graphite/70 sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/">
            <div className="group flex cursor-pointer items-center gap-2.5">
              <CroweMark
                size={28}
                className="transition-transform duration-200 ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-[1.06] motion-reduce:transition-none"
              />
              <span className="font-display text-[1.35rem] leading-none tracking-[-0.01em] text-parchment">
                AI Web Builder
              </span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <span className={navClass(location === item.href)}>{item.label}</span>
              </Link>
            ))}
            <div className="h-4 w-px bg-gold/15 mx-2" />
            {user ? (
              <>
                <span className="text-sm text-parchment-dim flex items-center gap-2">
                  {user.username}
                  {user.plan === "pro" && (
                    <span className="rounded-full border border-gold/30 px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-status uppercase text-gold">
                      Pro
                    </span>
                  )}
                </span>
                <Button variant="ghost" size="sm" onClick={() => logout()}>
                  Log out
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => openAuth("login")}>
                  Log in
                </Button>
                <Button size="sm" onClick={() => openAuth("register")}>
                  Get Started
                </Button>
              </>
            )}
          </nav>

          {/* Mobile Nav */}
          <div className="md:hidden">
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent>
                <div className="flex flex-col gap-4 mt-8">
                  {navItems.map((item) => (
                    <Link key={item.href} href={item.href}>
                      <span
                        className={`text-lg font-medium transition-colors hover:text-gold cursor-pointer flex items-center gap-2 ${
                          location === item.href ? "text-gold" : "text-parchment-dim"
                        }`}
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </span>
                    </Link>
                  ))}
                  <div className="h-px bg-gold/15 my-2" />
                  {user ? (
                    <Button
                      variant="outline"
                      className="w-full"
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
                        className="w-full"
                        onClick={() => {
                          openAuth("login");
                          setIsMobileMenuOpen(false);
                        }}
                      >
                        Log in
                      </Button>
                      <Button
                        className="w-full"
                        onClick={() => {
                          openAuth("register");
                          setIsMobileMenuOpen(false);
                        }}
                      >
                        Get Started
                      </Button>
                    </>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>

      <footer className="mt-20 border-t border-gold/15 bg-graphite-soft pb-8 pt-12">
        <div className="container mx-auto grid gap-8 px-4 md:grid-cols-4">
          <div>
            <div className="mb-4 flex items-center gap-2.5">
              <CroweMark size={24} />
              <span className="font-display text-lg leading-none tracking-[-0.01em] text-parchment">AI Web Builder</span>
            </div>
            <p className="text-sm text-parchment-dim">
              Describe your business. Get a website that's live.
            </p>
          </div>
          <div>
            <h4 className="text-xs tracking-eyebrow uppercase text-gold-dim mb-4">Product</h4>
            <ul className="space-y-2 text-sm text-parchment-dim">
              <li><a href="/#how-it-works" className="transition-colors hover:text-gold">How it works</a></li>
              <li><Link href="/pricing" className="transition-colors hover:text-gold">Pricing</Link></li>
              <li><Link href="/builder" className="transition-colors hover:text-gold">Start building</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs tracking-eyebrow uppercase text-gold-dim mb-4">Company</h4>
            <ul className="space-y-2 text-sm text-parchment-dim">
              <li><a href="https://www.crowelogic.com" target="_blank" rel="noreferrer" className="transition-colors hover:text-gold">About Crowe Logic</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs tracking-eyebrow uppercase text-gold-dim mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-parchment-dim">
              <li><Link href="/privacy" className="transition-colors hover:text-gold">Privacy</Link></li>
              <li><Link href="/terms" className="transition-colors hover:text-gold">Terms</Link></li>
            </ul>
          </div>
        </div>

        {/* Endorsement bar. The parent brand signs the product with its own
            drawn logotype rather than the product's type, which is the point of
            an endorsed lockup. The wordmark is 4.35:1, so it is sized by width;
            sizing a lockup that wide by height overflows a phone. */}
        <div className="container mx-auto mt-10 flex flex-col items-center gap-4 border-t border-gold/10 px-4 pt-8 sm:flex-row sm:justify-between">
          <a
            href="https://www.crowelogic.com"
            target="_blank"
            rel="noreferrer"
            className="group flex items-center gap-3"
          >
            <span className="font-mono text-[0.65rem] uppercase tracking-status text-gold-dim">
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
          <p className="font-mono text-[0.65rem] uppercase tracking-status text-parchment/35">
            Crowe Logic Inc.
          </p>
        </div>
      </footer>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultMode={authMode} />
    </div>
  );
}
