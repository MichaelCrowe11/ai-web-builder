import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  LayoutTemplate, 
  Briefcase, 
  ShoppingBag, 
  BookOpen, 
  Camera, 
  Utensils,
  Sparkles,
  X,
  LucideIcon
} from "lucide-react";

interface Template {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  prompt: string;
  category: string;
}

const templates: Template[] = [
  {
    id: "saas-landing",
    name: "SaaS Landing",
    description: "Modern software product page",
    icon: LayoutTemplate,
    prompt: "A modern SaaS landing page with a hero section featuring a gradient background, product screenshots, feature grid with icons, pricing table with 3 tiers, testimonials carousel, and a call-to-action footer. Use a clean blue and white color scheme.",
    category: "Business"
  },
  {
    id: "portfolio",
    name: "Portfolio",
    description: "Creative showcase site",
    icon: Briefcase,
    prompt: "A creative portfolio website for a designer with a minimalist hero section, project gallery with hover effects, about section with skills, and contact form. Use elegant typography and subtle animations.",
    category: "Personal"
  },
  {
    id: "ecommerce",
    name: "E-commerce",
    description: "Online store template",
    icon: ShoppingBag,
    prompt: "An e-commerce product landing page with a large hero product image, key features list, customer reviews section, size/color selectors, add to cart button, and trust badges. Modern and conversion-focused design.",
    category: "Business"
  },
  {
    id: "blog",
    name: "Blog",
    description: "Content-focused layout",
    icon: BookOpen,
    prompt: "A clean blog homepage with featured article hero, article grid with thumbnails and excerpts, sidebar with categories and newsletter signup, and author bio section. Use readable typography and plenty of whitespace.",
    category: "Content"
  },
  {
    id: "photography",
    name: "Photography",
    description: "Visual gallery showcase",
    icon: Camera,
    prompt: "A photography portfolio with full-width image hero, masonry gallery grid, about the photographer section, and contact information. Dark elegant theme that makes photos pop.",
    category: "Creative"
  },
  {
    id: "restaurant",
    name: "Restaurant",
    description: "Food & dining template",
    icon: Utensils,
    prompt: "A restaurant website with appetizing hero image, menu sections with food items and prices, about/story section, reservation form, and location map. Warm, inviting color palette.",
    category: "Local Business"
  }
];

interface TemplateGalleryProps {
  onSelect: (prompt: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function TemplateGallery({ onSelect, isOpen, onClose }: TemplateGalleryProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  
  const categories = ["All", ...Array.from(new Set(templates.map(t => t.category)))];
  
  const filteredTemplates = selectedCategory === "All" 
    ? templates 
    : templates.filter(t => t.category === selectedCategory);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-30 bg-background/95 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-heading font-semibold">Template Gallery</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Categories */}
        <div className="flex items-center gap-2 p-4 border-b border-border overflow-x-auto">
          {categories.map((category) => (
            <Button
              key={category}
              variant={selectedCategory === category ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(category)}
              className="whitespace-nowrap"
            >
              {category}
            </Button>
          ))}
        </div>
        
        {/* Templates Grid */}
        <ScrollArea className="flex-1 p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {filteredTemplates.map((template) => (
              <button
                key={template.id}
                onClick={() => {
                  onSelect(template.prompt);
                  onClose();
                }}
                className="group relative p-6 rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-lg transition-all duration-300 text-left"
              >
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4 group-hover:scale-110 transition-transform">
                  <template.icon className="h-6 w-6" />
                </div>
                <h3 className="font-semibold text-base mb-1">{template.name}</h3>
                <p className="text-sm text-muted-foreground">{template.description}</p>
                <span className="absolute top-3 right-3 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {template.category}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
