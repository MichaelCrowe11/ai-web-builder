import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Which form to show first; users can toggle.
  defaultMode?: "login" | "register";
  onSuccess?: () => void;
}

export function AuthModal({ open, onOpenChange, defaultMode = "login", onSuccess }: AuthModalProps) {
  const { login, register } = useAuth();
  const { toast } = useToast();
  const [mode, setMode] = useState<"login" | "register">(defaultMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const isRegister = mode === "register";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    try {
      if (isRegister) {
        await register(username.trim(), password, email.trim() || undefined);
        toast({ title: "Welcome!", description: "Your account is ready." });
      } else {
        await login(username.trim(), password);
        toast({ title: "Welcome back!" });
      }
      onOpenChange(false);
      onSuccess?.();
      setPassword("");
    } catch (err: any) {
      // apiRequest throws "<status>: <body>"; surface a friendly message.
      const msg = err?.message?.includes("409")
        ? "That username is taken."
        : err?.message?.includes("401")
        ? "Invalid username or password."
        : "Something went wrong. Please try again.";
      toast({ title: isRegister ? "Sign up failed" : "Login failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-heading">
            {isRegister ? "Create your account" : "Welcome back"}
          </DialogTitle>
          <DialogDescription>
            {isRegister
              ? "Sign up to publish your sites and save your work."
              : "Log in to continue building."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="auth-username">Username</Label>
            <Input
              id="auth-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          {isRegister && (
            <div className="space-y-2">
              <Label htmlFor="auth-email">Email (optional)</Label>
              <Input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="auth-password">Password</Label>
            <Input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {isRegister ? "Create account" : "Log in"}
          </Button>
        </form>

        <div className="text-center text-sm text-muted-foreground pt-2">
          {isRegister ? "Already have an account?" : "New here?"}{" "}
          <button
            type="button"
            className="text-primary font-medium hover:underline"
            onClick={() => setMode(isRegister ? "login" : "register")}
          >
            {isRegister ? "Log in" : "Sign up"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
