import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Cpu, LayoutTemplate, CreditCard, Menu } from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { AuthModal } from "@/components/auth/auth-modal";

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

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
                <Cpu className="h-5 w-5" />
              </div>
              <span className="font-heading font-bold text-xl tracking-tight">AI Web Builder</span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <span 
                  className={`text-sm font-medium transition-colors hover:text-primary cursor-pointer ${
                    location === item.href ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            ))}
            <div className="h-4 w-px bg-border mx-2" />
            {user ? (
              <>
                <span className="text-sm text-muted-foreground">
                  {user.username}
                  {user.plan === "pro" && (
                    <span className="ml-1 text-xs font-semibold text-amber-500">PRO</span>
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
                        className={`text-lg font-medium transition-colors hover:text-primary cursor-pointer flex items-center gap-2 ${
                          location === item.href ? "text-primary" : "text-muted-foreground"
                        }`}
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </span>
                    </Link>
                  ))}
                  <div className="h-px bg-border my-2" />
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

      <footer className="border-t border-border bg-muted/40 py-12 mt-20">
        <div className="container mx-auto px-4 grid md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="h-6 w-6 rounded-md bg-primary flex items-center justify-center text-primary-foreground">
                <Cpu className="h-4 w-4" />
              </div>
              <span className="font-heading font-bold text-lg">AI Web Builder</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Describe your business. Get a website that's live.
            </p>
          </div>
          <div>
            <h4 className="font-semibold mb-4">Product</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>Features</li>
              <li>Pricing</li>
              <li>Showcase</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-4">Company</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>About</li>
              <li>Blog</li>
              <li>Careers</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-4">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>Privacy</li>
              <li>Terms</li>
            </ul>
          </div>
        </div>
      </footer>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} defaultMode={authMode} />
    </div>
  );
}