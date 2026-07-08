import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import { cn } from '@/lib/utils'
import { $torchBrand, loadTorchBrand } from '@/store/torch-brand'

// Brand badge: the admin-uploaded logo (served by the brand server), or a
// monogram fallback tinted with the brand color. Size via className (default
// size-14).
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  const brand = useStore($torchBrand)

  useEffect(() => {
    void loadTorchBrand()
  }, [])

  const letter = (brand.displayName || 'T').trim().charAt(0).toUpperCase()

  return (
    <span
      className={cn(
        'inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white',
        className
      )}
      {...props}
    >
      {brand.iconUrl ? (
        <img alt="" className="size-full object-contain" src={brand.iconUrl} />
      ) : (
        <span
          className="flex size-full items-center justify-center font-bold text-white"
          style={{ background: brand.primaryColor, fontSize: '60%' }}
        >
          {letter}
        </span>
      )}
    </span>
  )
}
