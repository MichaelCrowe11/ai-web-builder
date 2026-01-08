import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Clock, RotateCcw, X, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export interface VersionSnapshot {
  id: string;
  html: string;
  css: string;
  prompt: string | null;
  timestamp: Date;
  label?: string;
}

interface VersionHistoryProps {
  versions: VersionSnapshot[];
  currentIndex: number;
  onRestore: (version: VersionSnapshot) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function VersionHistory({ 
  versions, 
  currentIndex,
  onRestore, 
  isOpen, 
  onClose 
}: VersionHistoryProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!isOpen) return null;

  return (
    <div className="absolute right-80 top-0 bottom-0 w-72 z-20 bg-background border-l border-border shadow-lg animate-in slide-in-from-right duration-300">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">Version History</h3>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Versions List */}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {versions.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No version history yet. Generate a website to start tracking changes.
              </div>
            ) : (
              versions.map((version, index) => (
                <button
                  key={version.id}
                  onClick={() => setSelectedId(selectedId === version.id ? null : version.id)}
                  className={`w-full p-3 rounded-lg text-left transition-colors ${
                    index === currentIndex
                      ? "bg-primary/10 border border-primary/30"
                      : selectedId === version.id
                      ? "bg-muted"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${
                        index === currentIndex ? "bg-primary" : "bg-muted-foreground"
                      }`} />
                      <span className="text-sm font-medium">
                        {version.label || `Version ${versions.length - index}`}
                      </span>
                    </div>
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${
                      selectedId === version.id ? "rotate-90" : ""
                    }`} />
                  </div>
                  <div className="mt-1 ml-4 text-xs text-muted-foreground">
                    {formatDistanceToNow(version.timestamp, { addSuffix: true })}
                  </div>
                  
                  {selectedId === version.id && (
                    <div className="mt-3 ml-4 space-y-2">
                      {version.prompt && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          "{version.prompt}"
                        </p>
                      )}
                      {index !== currentIndex && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full gap-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRestore(version);
                          }}
                        >
                          <RotateCcw className="h-3 w-3" />
                          Restore this version
                        </Button>
                      )}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </ScrollArea>
        
        {/* Footer */}
        <div className="p-3 border-t border-border bg-muted/30">
          <p className="text-xs text-muted-foreground text-center">
            {versions.length} version{versions.length !== 1 ? "s" : ""} saved
          </p>
        </div>
      </div>
    </div>
  );
}
