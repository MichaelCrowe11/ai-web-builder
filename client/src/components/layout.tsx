import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { LayoutTemplate, CreditCard, Menu } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { AuthModal } from "@/components/auth/auth-modal";
import { CroweHexC } from "@/components/brand/crowe-hex-c";

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
            <div className="flex items-center gap-2.5 cursor-pointer group">
              <CroweHexC size={26} className="transition-transform group-hover:scale-105" />
              <span className="font-heading text-xl tracking-tight text-parchment">
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

      <footer className="border-t border-gold/15 bg-graphite-soft py-12 mt-20">
        <div className="container mx-auto px-4 grid md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <CroweHexC size={24} />
              <span className="font-heading font-semibold text-lg text-parchment">AI Web Builder</span>
            </div>
            <p className="text-sm text-parchment-dim">
              Describe your business. Get a website that's live.
            </p>
            <p className="mt-3 text-[0.7rem] tracking-status uppercase text-gold-dim">
              A Crowe Logic product
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
      </footer>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultMode={authMode} />
    </div>
  );
}
