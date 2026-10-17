import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
// Buttons of the «Estación total» language (see styles/globals.css): opaque, 2 px radius, a
// 3,5:1 control border, the inverted fill for the primary action and no colour of their own
// except red for the destructive one.
const buttonVariants = cva('btn', {
  variants: {
    variant: {
      default: 'btn-primary',
      outline: '',
      ghost: 'btn-ghost',
      destructive: 'btn-danger',
    },
    size: { default: '', sm: 'btn-sm', icon: 'btn-icon' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}
export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
