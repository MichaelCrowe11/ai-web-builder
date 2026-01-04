import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Type, Palette, Layout, MousePointerClick } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DesignControlsProps {
  config: any;
  onChange: (key: string, value: any) => void;
}

export function DesignControls({ config, onChange }: DesignControlsProps) {
  return (
    <div className="w-80 border-l border-border bg-background flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <h3 className="font-heading font-semibold">Design System</h3>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Typography */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Type className="h-4 w-4" /> Typography
            </div>
            
            <div className="space-y-2">
              <Label>Heading Font</Label>
              <Select defaultValue="jakarta" onValueChange={(v) => onChange("headingFont", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select font" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="jakarta">Plus Jakarta Sans</SelectItem>
                  <SelectItem value="inter">Inter</SelectItem>
                  <SelectItem value="roboto">Roboto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Body Font</Label>
              <Select defaultValue="inter" onValueChange={(v) => onChange("bodyFont", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select font" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inter">Inter</SelectItem>
                  <SelectItem value="lato">Lato</SelectItem>
                  <SelectItem value="opensans">Open Sans</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Colors */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Palette className="h-4 w-4" /> Colors
            </div>
            
            <div className="grid grid-cols-5 gap-2">
              {["#4F46E5", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444"].map((color) => (
                <button
                  key={color}
                  className="w-8 h-8 rounded-full border border-border/20 shadow-sm hover:scale-110 transition-transform"
                  style={{ backgroundColor: color }}
                  onClick={() => onChange("primaryColor", color)}
                />
              ))}
            </div>
          </div>

          <Separator />

          {/* Spacing & Radius */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <Layout className="h-4 w-4" /> Layout
            </div>
            
            <div className="space-y-3">
              <Label>Border Radius</Label>
              <Slider defaultValue={[8]} max={20} step={1} onValueChange={(v) => onChange("borderRadius", v[0])} />
            </div>
            
            <div className="space-y-3">
              <Label>Spacing Scale</Label>
              <Slider defaultValue={[4]} max={8} step={1} onValueChange={(v) => onChange("spacing", v[0])} />
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}