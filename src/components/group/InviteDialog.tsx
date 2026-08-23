import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowsClockwise,
  Check,
  Copy,
  ShareNetwork,
  Prohibit,
} from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { friendlyError } from '@/lib/errors'
import { formatDate } from '@/lib/time'
import {
  inviteUrl,
  isInviteLive,
  useCreateInvite,
  useInvites,
  useRevokeInvite,
} from '@/data/invites'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/toast-context'

/**
 * Compartir el grupo.
 *
 * El link se genera en el servidor (32 caracteres base32, ~160 bits) y se puede
 * dar de baja cuando se quiera. La UI muestra un solo link vigente: tener cinco
 * links activos es la forma más fácil de perderle el rastro a quién puede
 * entrar.
 *
 * `navigator.share` sólo aparece si el dispositivo realmente lo soporta; si no,
 * queda el botón de copiar, que funciona en todos lados.
 */
export function InviteDialog({
  groupId,
  groupName,
  open,
  onClose,
}: {
  groupId: string
  groupName: string
  open: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const invites = useInvites(groupId, open)
  const createInvite = useCreateInvite(groupId)
  const revokeInvite = useRevokeInvite(groupId)
  const [copied, setCopied] = useState(false)

  const active = useMemo(
    () => (invites.data ?? []).find((invite) => isInviteLive(invite)) ?? null,
    [invites.data],
  )

  // Si el grupo no tiene ningún link vigente, se crea uno al abrir el diálogo:
  // nadie debería tener que pedir un link para poder compartir el grupo.
  //
  // El ref es necesario, no decorativo: `createInvite` cambia de identidad en
  // cada render, y entre la llamada a `mutate` y el render en que `isPending`
  // pasa a true hay una ventana en la que el efecto volvería a entrar y crearía
  // un segundo link. El ref cierra esa ventana de forma síncrona.
  const autoCreated = useRef(false)
  useEffect(() => {
    if (!open) {
      autoCreated.current = false
      return
    }
    if (autoCreated.current || invites.isLoading || invites.data === undefined) return
    if (active) return

    autoCreated.current = true
    createInvite.mutate(7)
  }, [open, invites.isLoading, invites.data, active, createInvite])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2200)
    return () => window.clearTimeout(timer)
  }, [copied])

  const url = active ? inviteUrl(active.token) : ''
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      toast.show({ message: 'No pudimos copiar. Seleccioná el link a mano.', tone: 'error' })
    }
  }

  const onShare = async (): Promise<void> => {
    try {
      await navigator.share({
        title: `Sumate a ${groupName} en Cantado`,
        text: `Te invito a ${groupName}. Hacemos predicciones sobre lo que va a pasar.`,
        url,
      })
    } catch {
      // Cancelar el share del sistema no es un error.
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Compartir con el grupo"
      description="Cualquiera con este link puede sumarse. Vence en 7 días y lo podés dar de baja cuando quieras."
    >
      {invites.isLoading || (!active && createInvite.isPending) ? (
        <div className="flex items-center gap-2.5 py-6 text-[var(--ink-2)]" role="status">
          <Spinner size={18} />
          Generando el link…
        </div>
      ) : !active ? (
        <div className="py-4">
          <p className="text-[var(--ink-2)]">
            No hay ningún link activo en este momento.
          </p>
          <Button
            className="mt-4"
            loading={createInvite.isPending}
            onClick={() =>
              createInvite.mutate(7, {
                onError: (error) =>
                  toast.show({ message: friendlyError(error), tone: 'error' }),
              })
            }
          >
            Generar un link
          </Button>
        </div>
      ) : (
        <>
          <p
            className={cn(
              'break-all rounded-[var(--r-sm)] border border-[var(--line-strong)]',
              'bg-[var(--surface-2)] px-3.5 py-3 font-mono text-[0.8125rem] text-[var(--ink-2)]',
            )}
          >
            {url}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={() => void onCopy()}
              succeeded={copied}
              iconLeft={<Copy size={16} weight="bold" aria-hidden="true" />}
            >
              {copied ? 'Copiado' : 'Copiar link'}
            </Button>

            {canShare && (
              <Button
                variant="secondary"
                onClick={() => void onShare()}
                iconLeft={<ShareNetwork size={16} weight="bold" aria-hidden="true" />}
              >
                Compartir
              </Button>
            )}
          </div>

          <p className="mt-3 type-micro text-[var(--ink-3)]">
            {active.expires_at
              ? `Vence el ${formatDate(active.expires_at)}.`
              : 'No vence.'}{' '}
            {active.uses === 0
              ? 'Todavía no lo usó nadie.'
              : active.uses === 1
                ? 'Lo usó 1 persona.'
                : `Lo usaron ${active.uses} personas.`}
          </p>

          <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
            <Button
              variant="ghost"
              size="sm"
              loading={createInvite.isPending}
              iconLeft={<ArrowsClockwise size={15} weight="bold" aria-hidden="true" />}
              onClick={() =>
                revokeInvite.mutate(active.id, {
                  onSuccess: () => createInvite.mutate(7),
                  onError: (error) =>
                    toast.show({ message: friendlyError(error), tone: 'error' }),
                })
              }
            >
              Generar uno nuevo
            </Button>

            <Button
              variant="ghost"
              size="sm"
              loading={revokeInvite.isPending}
              iconLeft={<Prohibit size={15} weight="bold" aria-hidden="true" />}
              className="text-[var(--danger)]"
              onClick={() =>
                revokeInvite.mutate(active.id, {
                  onSuccess: () =>
                    toast.show({ message: 'El link dejó de funcionar.', tone: 'neutral' }),
                  onError: (error) =>
                    toast.show({ message: friendlyError(error), tone: 'error' }),
                })
              }
            >
              Dar de baja
            </Button>
          </div>

          <p className="mt-4 flex items-start gap-2 type-micro text-[var(--ink-3)]">
            <Check size={14} weight="bold" className="mt-px shrink-0" aria-hidden="true" />
            Las predicciones del grupo son privadas: nadie que no tenga el link
            puede verlas, y los buscadores no las indexan.
          </p>
        </>
      )}
    </Sheet>
  )
}
