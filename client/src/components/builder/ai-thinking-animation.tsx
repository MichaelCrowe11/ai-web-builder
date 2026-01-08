import { motion } from "framer-motion";

interface AIThinkingAnimationProps {
  isVisible: boolean;
}

export function AIThinkingAnimation({ isVisible }: AIThinkingAnimationProps) {
  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <motion.div 
        className="flex flex-col items-center gap-6 p-8 rounded-2xl bg-card border border-border shadow-2xl"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.3 }}
      >
        {/* AI Brain Animation */}
        <div className="relative">
          <motion.div
            className="h-20 w-20 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center"
            animate={{ 
              boxShadow: [
                "0 0 0 0 rgba(99, 102, 241, 0.4)",
                "0 0 0 20px rgba(99, 102, 241, 0)",
              ]
            }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <motion.div
              className="h-12 w-12 rounded-full bg-gradient-to-br from-primary to-indigo-400 flex items-center justify-center"
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            >
              <svg 
                viewBox="0 0 24 24" 
                className="h-6 w-6 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
                <path d="M12 11v2" />
                <path d="M12 17a6 6 0 0 0 6-6" />
                <path d="M12 17a6 6 0 0 1-6-6" />
                <circle cx="12" cy="20" r="2" />
              </svg>
            </motion.div>
          </motion.div>
          
          {/* Orbiting particles */}
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute h-2 w-2 rounded-full bg-primary"
              style={{
                top: "50%",
                left: "50%",
              }}
              animate={{
                x: [0, 40, 0, -40, 0],
                y: [-40, 0, 40, 0, -40],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                delay: i * 1,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
        
        {/* Text */}
        <div className="text-center">
          <motion.h3 
            className="text-lg font-heading font-semibold text-foreground mb-2"
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            AI is crafting your website
          </motion.h3>
          <div className="flex items-center justify-center gap-1">
            {["Analyzing", "Designing", "Generating"].map((text, i) => (
              <motion.span
                key={text}
                className="text-sm text-muted-foreground"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0] }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  delay: i * 1,
                }}
              >
                {text}
                {i < 2 && <span className="mx-1">→</span>}
              </motion.span>
            ))}
          </div>
        </div>
        
        {/* Progress dots */}
        <div className="flex items-center gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <motion.div
              key={i}
              className="h-2 w-2 rounded-full bg-primary"
              animate={{ 
                scale: [1, 1.5, 1],
                opacity: [0.3, 1, 0.3]
              }}
              transition={{
                duration: 0.8,
                repeat: Infinity,
                delay: i * 0.15,
              }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}
