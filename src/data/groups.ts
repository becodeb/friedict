import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from './keys'
import type { Group, MemberRole, MemberWithProfile, Profile } from '@/lib/types'

/**
 * Lecturas por PostgREST, escrituras por RPC.
 *
 * Ninguna mutación manda `group_id` o `created_by` esperando que el servidor
 * confíe: las funciones SECURITY DEFINER resuelven el usuario con `auth.uid()`
 * y verifican membresía y rol antes de tocar nada.
 */

export interface GroupSummary extends Group {
  role: MemberRole
  memberCount: number
}

export function useMyGroups(enabled = true) {
  return useQuery({
    queryKey: qk.myGroups(),
    enabled,
    queryFn: async (): Promise<GroupSummary[]> => {
      // RLS ya limita `group_members` a mis grupos, así que esto no necesita
      // filtrar por usuario: no hay forma de leer la membresía de otra persona.
      const { data, error } = await supabase
        .from('group_members')
        .select('role, joined_at, group:groups(*)')
        .order('joined_at', { ascending: true })
      if (error) throw error

      const rows = (data ?? []).filter(
        (r): r is typeof r & { group: Group } => r.group !== null,
      )
      if (rows.length === 0) return []

      // Un solo viaje más para todos los conteos: nada de N+1.
      const { data: counts, error: countError } = await supabase
        .from('group_members')
        .select('group_id')
        .in(
          'group_id',
          rows.map((r) => r.group.id),
        )
      if (countError) throw countError

      const tally = new Map<string, number>()
      for (const row of counts ?? []) {
        tally.set(row.group_id, (tally.get(row.group_id) ?? 0) + 1)
      }

      return rows.map((r) => ({
        ...r.group,
        role: r.role,
        memberCount: tally.get(r.group.id) ?? 1,
      }))
    },
    staleTime: 30_000,
  })
}

export function useGroup(groupId: string | undefined) {
  return useQuery({
    queryKey: qk.group(groupId ?? ''),
    enabled: Boolean(groupId),
    queryFn: async (): Promise<Group> => {
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .eq('id', groupId!)
        .single()
      if (error) throw error
      return data
    },
    staleTime: 60_000,
  })
}

export function useMembers(groupId: string | undefined) {
  return useQuery({
    queryKey: qk.members(groupId ?? ''),
    enabled: Boolean(groupId),
    queryFn: async (): Promise<MemberWithProfile[]> => {
      const { data, error } = await supabase
        .from('group_members')
        .select('*, profile:profiles(*)')
        .eq('group_id', groupId!)
        .order('joined_at', { ascending: true })
      if (error) throw error

      return (data ?? [])
        .filter((r): r is typeof r & { profile: Profile } => r.profile !== null)
        .map((r) => ({ ...r, profile: r.profile }))
    },
    staleTime: 30_000,
  })
}

export function useMyProfile(userId: string | undefined) {
  return useQuery({
    queryKey: qk.profile(userId ?? ''),
    enabled: Boolean(userId),
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId!)
        .maybeSingle()
      if (error) throw error
      return data
    },
    staleTime: 5 * 60_000,
  })
}

export function useCreateGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      displayName: string
      accent: number
    }): Promise<Group> => {
      // `p_avatar_seed` se omite a propósito: la función lo deriva del nombre.
      const { data, error } = await supabase.rpc('create_group', {
        p_name: input.name,
        p_display_name: input.displayName,
        p_accent: input.accent,
      })
      if (error) throw error
      return data as unknown as Group
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.myGroups() })
    },
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { displayName: string; accent: number }) => {
      const { data, error } = await supabase.rpc('upsert_profile', {
        p_display_name: input.displayName,
        p_accent: input.accent,
      })
      if (error) throw error
      return data as unknown as Profile
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(qk.profile(profile.id), profile)
      void queryClient.invalidateQueries({ queryKey: ['members'] })
    },
  })
}

export function useLeaveGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase.rpc('leave_group', { p_group_id: groupId })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.myGroups() })
    },
  })
}

export function useUpdateMemberRole(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { userId: string; role: MemberRole }) => {
      const { error } = await supabase.rpc('update_member_role', {
        p_group_id: groupId,
        p_user_id: input.userId,
        p_role: input.role,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.members(groupId) })
    },
  })
}

export function useRemoveMember(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc('remove_member', {
        p_group_id: groupId,
        p_user_id: userId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.members(groupId) })
      void queryClient.invalidateQueries({ queryKey: qk.leaderboard(groupId) })
    },
  })
}
