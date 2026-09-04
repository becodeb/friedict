import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, rpc } from '@/lib/api'
import { qk } from './keys'
import type { Group, MemberRole, MemberWithProfile, Profile } from '@/lib/types'

/**
 * Lecturas por GET, escrituras por función de dominio.
 *
 * Ninguna mutación manda `group_id` o `created_by` esperando que el servidor
 * confíe: las funciones SECURITY DEFINER resuelven el usuario por su cuenta
 * —ahora leyendo la GUC que el servidor escribe por transacción— y verifican
 * membresía y rol antes de tocar nada. El servidor Node es un pasamanos: no
 * decide permisos.
 */

export interface GroupSummary extends Group {
  role: MemberRole
  memberCount: number
}

interface GroupRow extends Group {
  role: MemberRole
  member_count: number
}

export function useMyGroups(enabled = true) {
  return useQuery({
    queryKey: qk.myGroups(),
    enabled,
    queryFn: async (): Promise<GroupSummary[]> => {
      // La RLS ya limita las filas a mis grupos: el endpoint no filtra por
      // usuario y no hace falta que lo haga.
      const rows = await apiGet<GroupRow[]>('/groups')
      return rows.map(({ member_count, ...group }) => ({
        ...group,
        memberCount: member_count,
      }))
    },
    staleTime: 30_000,
  })
}

export function useGroup(groupId: string | undefined) {
  return useQuery({
    queryKey: qk.group(groupId ?? ''),
    enabled: Boolean(groupId),
    queryFn: () => apiGet<Group>(`/groups/${groupId!}`),
    staleTime: 60_000,
  })
}

export function useMembers(groupId: string | undefined) {
  return useQuery({
    queryKey: qk.members(groupId ?? ''),
    enabled: Boolean(groupId),
    queryFn: () => apiGet<MemberWithProfile[]>(`/groups/${groupId!}/members`),
    staleTime: 30_000,
  })
}

export function useMyProfile(userId: string | undefined) {
  return useQuery({
    queryKey: qk.profile(userId ?? ''),
    enabled: Boolean(userId),
    queryFn: () => apiGet<Profile | null>(`/profiles/${userId!}`),
    staleTime: 5 * 60_000,
  })
}

export function useCreateGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; displayName: string; accent: number }) =>
      // `p_avatar_seed` se omite a propósito: la función lo deriva del nombre.
      rpc<Group>('create_group', {
        p_name: input.name,
        p_display_name: input.displayName,
        p_accent: input.accent,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.myGroups() })
    },
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { displayName: string; accent: number }) =>
      rpc<Profile>('upsert_profile', {
        p_display_name: input.displayName,
        p_accent: input.accent,
      }),
    onSuccess: (profile) => {
      queryClient.setQueryData(qk.profile(profile.id), profile)
      void queryClient.invalidateQueries({ queryKey: ['members'] })
    },
  })
}

export function useLeaveGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (groupId: string) => rpc<void>('leave_group', { p_group_id: groupId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.myGroups() })
    },
  })
}

export interface UpdateGroupSettingsInput {
  closeRequestQuorum?: number
  qualificationEnabled?: boolean
  qualificationPercent?: number
}

/**
 * Único escritor de `close_request_quorum` / `qualification_enabled` /
 * `qualification_percent`. Invalida `qk.group` Y `qk.predictions`: los
 * requisitos derivados (`required_participants`, `close_required`) viajan en
 * cada fila de predicción, así que un cambio de ajustes tiene que refrescarlas
 * también, no sólo la fila del grupo.
 */
export function useUpdateGroupSettings(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateGroupSettingsInput) =>
      rpc<Group>('update_group_settings', {
        p_group_id: groupId,
        ...(input.closeRequestQuorum !== undefined
          ? { p_close_request_quorum: input.closeRequestQuorum }
          : {}),
        ...(input.qualificationEnabled !== undefined
          ? { p_qualification_enabled: input.qualificationEnabled }
          : {}),
        ...(input.qualificationPercent !== undefined
          ? { p_qualification_percent: input.qualificationPercent }
          : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.group(groupId) })
      void queryClient.invalidateQueries({ queryKey: qk.predictions(groupId) })
    },
  })
}

export function useUpdateMemberRole(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { userId: string; role: MemberRole }) =>
      rpc<void>('update_member_role', {
        p_group_id: groupId,
        p_user_id: input.userId,
        p_role: input.role,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.members(groupId) })
    },
  })
}

export function useRemoveMember(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      rpc<void>('remove_member', { p_group_id: groupId, p_user_id: userId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.members(groupId) })
      void queryClient.invalidateQueries({ queryKey: qk.leaderboard(groupId) })
    },
  })
}
