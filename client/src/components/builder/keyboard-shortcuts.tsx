import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

interface KeyboardShortcutsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const shortcuts = [
  { category: "General", items: [
    { keys: ["Ctrl", "K"], description: "Open command palette" },
    { keys: ["Ctrl", "S"], description: "Save project" },
    { keys: ["Ctrl", "E"], description: "Export project" },
    { keys: ["?"], description: "Show keyboard shortcuts" },
  ]},
  { category: "Editor", items: [
    { keys: ["Ctrl", "Enter"], description: "Generate from prompt" },
    { keys: ["Ctrl", "Z"], description: "Undo last change" },
    { keys: ["Ctrl", "Shift", "Z"], description: "Redo last change" },
    { keys: ["Tab"], description: "Cycle through suggestions" },
  ]},
  { category: "View", items: [
    { keys: ["Ctrl", "1"], description: "Desktop preview" },
    { keys: ["Ctrl", "2"], description: "Tablet preview" },
    { keys: ["Ctrl", "3"], description: "Mobile preview" },
    { keys: ["Ctrl", "`"], description: "Toggle code view" },
    { keys: ["Ctrl", "T"], description: "Open template gallery" },
  ]},
];

export function KeyboardShortcuts({ open, onOpenChange }: KeyboardShortcutsProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-heading font-bold">Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Speed up your workflow with these handy shortcuts
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-6 py-4">
          {shortcuts.map((section) => (
            <div key={section.category}>
              <h3 className="text-sm font-semibold text-primary mb-3">{section.category}</h3>
              <div className="space-y-2">
                {section.items.map((shortcut, i) => (
                  <div 
                    key={i}
                    className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-sm text-foreground">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, j) => (
                        <span key={j} className="flex items-center">
                          <Kbd>{key}</Kbd>
                          {j < shortcut.keys.length - 1 && <span className="mx-1 text-muted-foreground">+</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
