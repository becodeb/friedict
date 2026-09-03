export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      activity_events: {
        Row: {
          actor_id: string | null
          created_at: string
          group_id: string
          id: string
          payload: Json
          prediction_id: string | null
          type: Database["public"]["Enums"]["activity_type"]
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          group_id: string
          id?: string
          payload?: Json
          prediction_id?: string | null
          type: Database["public"]["Enums"]["activity_type"]
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          group_id?: string
          id?: string
          payload?: Json
          prediction_id?: string | null
          type?: Database["public"]["Enums"]["activity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      group_invites: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          group_id: string
          id: string
          max_uses: number | null
          revoked_at: string | null
          token: string
          uses: number
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          group_id: string
          id?: string
          max_uses?: number | null
          revoked_at?: string | null
          token: string
          uses?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          group_id?: string
          id?: string
          max_uses?: number | null
          revoked_at?: string | null
          token?: string
          uses?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invites_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          group_id: string
          joined_at: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          group_id: string
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          group_id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prediction_option_tallies: {
        Row: {
          option_id: string
          prediction_id: string
          updated_at: string
          vote_count: number
          voter_count: number
        }
        Insert: {
          option_id: string
          prediction_id: string
          updated_at?: string
          vote_count?: number
          voter_count?: number
        }
        Update: {
          option_id?: string
          prediction_id?: string
          updated_at?: string
          vote_count?: number
          voter_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "prediction_option_tallies_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: true
            referencedRelation: "prediction_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prediction_option_tallies_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      prediction_options: {
        Row: {
          created_at: string
          created_by: string
          id: string
          label: string
          member_id: string | null
          position: number
          prediction_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          label: string
          member_id?: string | null
          position?: number
          prediction_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          label?: string
          member_id?: string | null
          position?: number
          prediction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prediction_options_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prediction_options_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prediction_options_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      prediction_resolutions: {
        Row: {
          created_at: string
          id: string
          prediction_id: string
          proposed_by: string
          proposed_option_id: string
          required_confirmations: number
          settled_at: string | null
          status: Database["public"]["Enums"]["resolution_status"]
        }
        Insert: {
          created_at?: string
          id?: string
          prediction_id: string
          proposed_by: string
          proposed_option_id: string
          required_confirmations?: number
          settled_at?: string | null
          status?: Database["public"]["Enums"]["resolution_status"]
        }
        Update: {
          created_at?: string
          id?: string
          prediction_id?: string
          proposed_by?: string
          proposed_option_id?: string
          required_confirmations?: number
          settled_at?: string | null
          status?: Database["public"]["Enums"]["resolution_status"]
        }
        Relationships: [
          {
            foreignKeyName: "prediction_resolutions_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prediction_resolutions_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prediction_resolutions_proposed_option_id_fkey"
            columns: ["proposed_option_id"]
            isOneToOne: false
            referencedRelation: "prediction_options"
            referencedColumns: ["id"]
          },
        ]
      }
      prediction_scores: {
        Row: {
          conviction_multiplier: number
          correct: boolean
          created_at: string
          early_multiplier: number
          group_id: string
          points: number
          prediction_id: string
          rarity_multiplier: number
          user_id: string
        }
        Insert: {
          conviction_multiplier?: number
          correct?: boolean
          created_at?: string
          early_multiplier?: number
          group_id: string
          points?: number
          prediction_id: string
          rarity_multiplier?: number
          user_id: string
        }
        Update: {
          conviction_multiplier?: number
          correct?: boolean
          created_at?: string
          early_multiplier?: number
          group_id?: string
          points?: number
          prediction_id?: string
          rarity_multiplier?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prediction_scores_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prediction_scores_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prediction_scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      prediction_templates: {
        Row: {
          category: string
          default_hours: number
          description: string | null
          id: string
          is_active: boolean
          option_type: Database["public"]["Enums"]["option_source"]
          options: string[]
          sort_order: number
          title: string
          voting_mode: Database["public"]["Enums"]["voting_mode"]
        }
        Insert: {
          category?: string
          default_hours?: number
          description?: string | null
          id?: string
          is_active?: boolean
          option_type?: Database["public"]["Enums"]["option_source"]
          options?: string[]
          sort_order?: number
          title: string
          voting_mode?: Database["public"]["Enums"]["voting_mode"]
        }
        Update: {
          category?: string
          default_hours?: number
          description?: string | null
          id?: string
          is_active?: boolean
          option_type?: Database["public"]["Enums"]["option_source"]
          options?: string[]
          sort_order?: number
          title?: string
          voting_mode?: Database["public"]["Enums"]["voting_mode"]
        }
        Relationships: []
      }
      prediction_votes: {
        Row: {
          created_at: string
          cycle: number
          id: string
          option_id: string
          prediction_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          cycle?: number
          id?: string
          option_id: string
          prediction_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          cycle?: number
          id?: string
          option_id?: string
          prediction_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prediction_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "prediction_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prediction_votes_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prediction_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      predictions: {
        Row: {
          allow_new_options: boolean
          close_percent: number
          close_request_count: number
          closed_at: string | null
          closes_at: string | null
          created_at: string
          created_by: string
          description: string | null
          group_id: string
          id: string
          is_default: boolean
          minimum_participants: number
          opens_at: string
          option_type: Database["public"]["Enums"]["option_source"]
          participant_count: number
          qualification_deadline: string
          qualification_percent: number
          resolved_at: string | null
          resolved_option_id: string | null
          results_visibility: Database["public"]["Enums"]["results_visibility"]
          status: Database["public"]["Enums"]["prediction_status"]
          template_id: string | null
          title: string
          updated_at: string
          vote_count: number
          vote_interval: string | null
          votes_visibility: Database["public"]["Enums"]["votes_visibility"]
          voting_mode: Database["public"]["Enums"]["voting_mode"]
        }
        Insert: {
          allow_new_options?: boolean
          close_percent?: number
          close_request_count?: number
          closed_at?: string | null
          closes_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          group_id: string
          id?: string
          is_default?: boolean
          minimum_participants?: number
          opens_at?: string
          option_type?: Database["public"]["Enums"]["option_source"]
          participant_count?: number
          qualification_deadline: string
          qualification_percent?: number
          resolved_at?: string | null
          resolved_option_id?: string | null
          results_visibility?: Database["public"]["Enums"]["results_visibility"]
          status?: Database["public"]["Enums"]["prediction_status"]
          template_id?: string | null
          title: string
          updated_at?: string
          vote_count?: number
          vote_interval?: string | null
          votes_visibility?: Database["public"]["Enums"]["votes_visibility"]
          voting_mode?: Database["public"]["Enums"]["voting_mode"]
        }
        Update: {
          allow_new_options?: boolean
          close_percent?: number
          close_request_count?: number
          closed_at?: string | null
          closes_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          group_id?: string
          id?: string
          is_default?: boolean
          minimum_participants?: number
          opens_at?: string
          option_type?: Database["public"]["Enums"]["option_source"]
          participant_count?: number
          qualification_deadline?: string
          qualification_percent?: number
          resolved_at?: string | null
          resolved_option_id?: string | null
          results_visibility?: Database["public"]["Enums"]["results_visibility"]
          status?: Database["public"]["Enums"]["prediction_status"]
          template_id?: string | null
          title?: string
          updated_at?: string
          vote_count?: number
          vote_interval?: string | null
          votes_visibility?: Database["public"]["Enums"]["votes_visibility"]
          voting_mode?: Database["public"]["Enums"]["voting_mode"]
        }
        Relationships: [
          {
            foreignKeyName: "predictions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictions_resolved_option_fk"
            columns: ["resolved_option_id"]
            isOneToOne: false
            referencedRelation: "prediction_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "predictions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "prediction_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          accent: number
          avatar_seed: string
          created_at: string
          display_name: string
          id: string
          updated_at: string
        }
        Insert: {
          accent?: number
          avatar_seed?: string
          created_at?: string
          display_name: string
          id: string
          updated_at?: string
        }
        Update: {
          accent?: number
          avatar_seed?: string
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          user_id: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          user_id: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      resolution_confirmations: {
        Row: {
          agrees: boolean
          created_at: string
          resolution_id: string
          user_id: string
        }
        Insert: {
          agrees: boolean
          created_at?: string
          resolution_id: string
          user_id: string
        }
        Update: {
          agrees?: boolean
          created_at?: string
          resolution_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resolution_confirmations_resolution_id_fkey"
            columns: ["resolution_id"]
            isOneToOne: false
            referencedRelation: "prediction_resolutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resolution_confirmations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      group_leaderboard: {
        Row: {
          accent: number | null
          avatar_seed: string | null
          display_name: string | null
          group_id: string | null
          hits: number | null
          points: number | null
          points_30d: number | null
          position: number | null
          resolved_predictions: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_prediction_option: {
        Args: { p_label: string; p_prediction_id: string }
        Returns: {
          created_at: string
          created_by: string
          id: string
          label: string
          member_id: string | null
          position: number
          prediction_id: string
        }
        SetofOptions: {
          from: "*"
          to: "prediction_options"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      calculate_points: {
        Args: {
          p_base: number
          p_conviction_ratio: number
          p_early_ratio: number
          p_sample_size: number
          p_winner_share: number
        }
        Returns: number
      }
      can_read_prediction: {
        Args: { p_prediction_id: string }
        Returns: boolean
      }
      can_see_results: { Args: { p_prediction_id: string }; Returns: boolean }
      can_see_votes: { Args: { p_prediction_id: string }; Returns: boolean }
      cancel_prediction: {
        Args: { p_prediction_id: string }
        Returns: undefined
      }
      cast_vote: {
        Args: { p_option_id: string; p_prediction_id: string }
        Returns: Json
      }
      confirm_resolution: {
        Args: { p_agrees: boolean; p_resolution_id: string }
        Returns: Json
      }
      create_group: {
        Args: {
          p_accent?: number
          p_avatar_seed?: string
          p_display_name: string
          p_name: string
        }
        Returns: {
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_invite: {
        Args: { p_expires_in?: string; p_group_id: string; p_max_uses?: number }
        Returns: {
          created_at: string
          created_by: string
          expires_at: string | null
          group_id: string
          id: string
          max_uses: number | null
          revoked_at: string | null
          token: string
          uses: number
        }
        SetofOptions: {
          from: "*"
          to: "group_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_prediction: {
        Args: {
          p_allow_new_options?: boolean
          p_close_percent?: number
          p_closes_at?: string | null
          p_description?: string
          p_group_id: string
          p_option_type?: Database["public"]["Enums"]["option_source"]
          p_options: string[]
          p_qualification_hours?: number
          p_qualification_percent?: number
          p_results_visibility?: Database["public"]["Enums"]["results_visibility"]
          p_title: string
          p_vote_interval?: string
          p_votes_visibility?: Database["public"]["Enums"]["votes_visibility"]
          p_voting_mode?: Database["public"]["Enums"]["voting_mode"]
        }
        Returns: string
      }
      create_prediction_from_template: {
        Args: {
          p_closes_at: string
          p_group_id: string
          p_qualification_hours?: number
          p_template_id: string
        }
        Returns: string
      }
      current_cycle: {
        Args: { p_at?: string; p_interval: string; p_opens_at: string }
        Returns: number
      }
      enforce_rate_limit: {
        Args: { p_bucket: string; p_max: number; p_window: string }
        Returns: undefined
      }
      finalize_predictions: { Args: { p_group_id?: string }; Returns: number }
      generate_invite_token: { Args: never; Returns: string }
      group_role: {
        Args: { p_group_id: string }
        Returns: Database["public"]["Enums"]["member_role"]
      }
      is_group_admin: { Args: { p_group_id: string }; Returns: boolean }
      is_group_member: { Args: { p_group_id: string }; Returns: boolean }
      join_group: {
        Args: {
          p_accent?: number
          p_avatar_seed?: string
          p_display_name: string
          p_token: string
        }
        Returns: string
      }
      leave_group: { Args: { p_group_id: string }; Returns: undefined }
      peek_invite: { Args: { p_token: string }; Returns: Json }
      propose_resolution: {
        Args: { p_option_id: string; p_prediction_id: string }
        Returns: string
      }
      refresh_prediction_counts: {
        Args: { p_prediction_id: string }
        Returns: undefined
      }
      remove_member: {
        Args: { p_group_id: string; p_user_id: string }
        Returns: undefined
      }
      request_close: { Args: { p_prediction_id: string }; Returns: Json }
      withdraw_close_request: { Args: { p_prediction_id: string }; Returns: Json }
      required_participants: {
        Args: { p_member_count: number; p_percent: number }
        Returns: number
      }
      required_close_requests: {
        Args: { p_member_count: number; p_percent: number }
        Returns: number
      }
      require_auth: { Args: never; Returns: string }
      revoke_invite: { Args: { p_invite_id: string }; Returns: undefined }
      score_prediction: {
        Args: { p_prediction_id: string }
        Returns: undefined
      }
      shares_group_with: { Args: { p_user_id: string }; Returns: boolean }
      update_member_role: {
        Args: {
          p_group_id: string
          p_role: Database["public"]["Enums"]["member_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      upsert_profile: {
        Args: {
          p_accent?: number
          p_avatar_seed?: string
          p_display_name: string
        }
        Returns: {
          accent: number
          avatar_seed: string
          created_at: string
          display_name: string
          id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      vote_timeline: {
        Args: { p_prediction_id: string }
        Returns: {
          bucket_at: string
          cycle: number
          option_id: string
          votes: number
        }[]
      }
    }
    Enums: {
      activity_type:
        | "member_joined"
        | "prediction_created"
        | "prediction_qualified"
        | "prediction_expired"
        | "prediction_closed"
        | "resolution_proposed"
        | "prediction_resolved"
        | "prediction_cancelled"
      member_role: "owner" | "admin" | "member"
      option_source: "manual" | "members" | "open"
      prediction_status:
        | "proposed"
        | "active"
        | "closed"
        | "resolving"
        | "resolved"
        | "expired"
        | "cancelled"
      resolution_status: "proposed" | "confirmed" | "disputed" | "rejected"
      results_visibility: "always" | "after_vote" | "on_close"
      votes_visibility: "visible" | "on_close" | "anonymous"
      voting_mode: "single" | "recurring"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_type: [
        "member_joined",
        "prediction_created",
        "prediction_qualified",
        "prediction_expired",
        "prediction_closed",
        "resolution_proposed",
        "prediction_resolved",
        "prediction_cancelled",
      ],
      member_role: ["owner", "admin", "member"],
      option_source: ["manual", "members", "open"],
      prediction_status: [
        "proposed",
        "active",
        "closed",
        "resolving",
        "resolved",
        "expired",
        "cancelled",
      ],
      resolution_status: ["proposed", "confirmed", "disputed", "rejected"],
      results_visibility: ["always", "after_vote", "on_close"],
      votes_visibility: ["visible", "on_close", "anonymous"],
      voting_mode: ["single", "recurring"],
    },
  },
} as const

