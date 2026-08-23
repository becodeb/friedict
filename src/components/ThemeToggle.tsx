import { Moon, Sun } from '@phosphor-icons/react'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/cn'
import { Tooltip } from './ui/Tooltip'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'

  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        className={cn(
          'grid size-[var(--tap)] place-items-center rounded-[var(--r-sm)]',
          'text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]',
          'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
          className,
        )}
      >
        {theme === 'dark' ? (
          <Sun size={18} weight="bold" aria-hidden="true" />
        ) : (
          <Moon size={18} weight="bold" aria-hidden="true" />
        )}
      </button>
    </Tooltip>
  )
}
