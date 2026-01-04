import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { Link } from "wouter";
import { ArrowRight, Sparkles, Zap, Shield, Code } from "lucide-react";
import heroBg from "@assets/generated_images/abstract_gradient_mesh_background_with_deep_violet_and_blue_tones.png";

export default function Home() {
  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative overflow-hidden pt-20 pb-32 md:pt-32">
        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none">
          <img 
            src={heroBg} 
            alt="Background" 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background"></div>
        </div>
        
        <div className="container mx-auto px-4 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <Sparkles className="h-3.5 w-3.5" />
            <span>AI-Powered Website Builder V2.0 is live</span>
          </div>
          
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-heading font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
            Describe your dream site.<br />
            <span className="text-primary">We build it instantly.</span>
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
            Generate production-ready React code, stunning designs, and full copy just by chatting. No coding required, but fully extensible if you want.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-10 duration-700 delay-300">
            <Link href="/builder">
              <Button size="lg" className="h-12 px-8 text-base shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all">
                Start Building Free <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="h-12 px-8 text-base">
              View Showcase
            </Button>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-heading font-bold mb-4">Why WebGen AI?</h2>
            <p className="text-muted-foreground">
              We don't just paste code. We architect solutions with a production-ready stack.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: Zap,
                title: "Instant Generation",
                description: "From prompt to preview in under 30 seconds. Iterate in real-time."
              },
              {
                icon: Code,
                title: "Clean React Code",
                description: "Export standard React + Tailwind code. No vendor lock-in."
              },
              {
                icon: Shield,
                title: "Enterprise Ready",
                description: "Secure, scalable, and built on modern infrastructure."
              }
            ].map((feature, i) => (
              <div key={i} className="p-6 rounded-2xl bg-card border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4">
                  <feature.icon className="h-6 w-6" />
                </div>
                <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </Layout>
  );
}