import lightLogo from '@/resources/build/icons/light/mark.svg'
import darkLogo from '@/resources/build/icons/dark/mark.svg'

interface NotyraLogoProps {
  size?: number
  className?: string
}

export function NotyraLogo({ size = 24, className = '' }: NotyraLogoProps) {
  return (
    <span
      aria-label="Notyra"
      className={`inline-flex shrink-0 items-center justify-center align-middle ${className}`}
      role="img"
      style={{ height: size, width: size }}
    >
      <img
        alt=""
        className="block h-full w-full object-contain dark:hidden"
        draggable={false}
        height={size}
        src={lightLogo}
        width={size}
      />
      <img
        alt=""
        className="hidden h-full w-full object-contain dark:block"
        draggable={false}
        height={size}
        src={darkLogo}
        width={size}
      />
    </span>
  )
}
