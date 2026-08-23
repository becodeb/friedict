import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from './keys'
import type { GroupInvite, InvitePreview } from '@/lib/types'

/** URL que se comparte por WhatsApp / Telegram / lo que sea. */
export function inviteUrl(token: string): string {
  return `${window.location.origin}/join/${token}`
}

export function isInviteLive(invite: GroupInvite, now: Date = new Date()): boolean {
  if (invite.revoked_at) return false
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= now.getTime()) {
    return false
  }
  if (invite.max_uses !== null && invite.uses >= invite.max_uses) return false
  return true
}

export function useInvites(groupId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.invites(groupId ?? ''),
    // La RLS de `group_invites` sólo deja leer a owner/admin. Un member que
    // llegue acá recibe una lista vacía, no un error que confirme que existen.
    enabled: Boolean(groupId) && enabled,
    queryFn: async (): Promise<GroupInvite[]> => {
      const { data, error } = await supabase
        .from('group_invites')
        .select('*')
        .eq('group_id', groupId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    staleTime: 30_000,
  })
}

export function useCreateInvite(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (expiresInDays: number): Promise<GroupInvite> => {
      // `p_max_uses` se omite: los links del grupo no tienen tope de usos, sólo
      // vencimiento y baja manual.
      const { data, error } = await supabase.rpc('create_invite', {
        p_group_id: groupId,
        p_expires_in: `${expiresInDays} days`,
      })
      if (error) throw error
      return data as unknown as GroupInvite
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.invites(groupId) })
    },
  })
}

export function useRevokeInvite(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.rpc('revoke_invite', { p_invite_id: inviteId })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.invites(groupId) })
    },
  })
}

/**
 * Vista previa de una invitación. Se puede llamar sin sesión: es la pantalla que
 * ve alguien que abre el link desde un chat.
 *
 * Un token inexistente, vencido, revocado o agotado devuelven todos
 * `{ valid: false }` y nada más. Nunca se filtra si el grupo existe.
 */
export function usePeekInvite(token: string | undefined) {
  return useQuery({
    queryKey: qk.invitePreview(token ?? ''),
    enabled: Boolean(token),
    queryFn: async (): Promise<InvitePreview> => {
      const { data, error } = await supabase.rpc('peek_invite', { p_token: token! })
      if (error) throw error
      return (data ?? { valid: false }) as unknown as InvitePreview
    },
    retry: false,
    staleTime: 0,
  })
}

export function useJoinGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      token: string
      displayName: string
      accent: number
    }): Promise<string> => {
      const { data, error } = await supabase.rpc('join_group', {
        p_token: vars.token,
        p_display_name: vars.displayName,
        p_accent: vars.accent,
      })
      if (error) throw error
      return data as unknown as string
    },
    onSuccess: (groupId) => {
      void queryClient.invalidateQueries({ queryKey: qk.myGroups() })
      void queryClient.invalidateQueries({ queryKey: qk.members(groupId) })
    },
  })
}
