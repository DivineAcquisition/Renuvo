export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      cadence_profiles: {
        Row: {
          created_at: string
          id: string
          interval_days: number
          key: string
          label: string
          vertical_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          interval_days: number
          key: string
          label: string
          vertical_id: string
        }
        Update: {
          created_at?: string
          id?: string
          interval_days?: number
          key?: string
          label?: string
          vertical_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cadence_profiles_vertical_id_fkey"
            columns: ["vertical_id"]
            isOneToOne: false
            referencedRelation: "verticals"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          email: string | null
          external_ref: string | null
          full_name: string | null
          id: string
          notes: string | null
          opted_out: boolean
          opted_out_at: string | null
          organization_id: string
          phone: string
          sms_consent: boolean
          sms_consent_at: string | null
          sms_consent_source: string | null
          sms_sendable: boolean | null
          source: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          external_ref?: string | null
          full_name?: string | null
          id?: string
          notes?: string | null
          opted_out?: boolean
          opted_out_at?: string | null
          organization_id: string
          phone: string
          sms_consent?: boolean
          sms_consent_at?: string | null
          sms_consent_source?: string | null
          sms_sendable?: boolean | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          external_ref?: string | null
          full_name?: string | null
          id?: string
          notes?: string | null
          opted_out?: boolean
          opted_out_at?: string | null
          organization_id?: string
          phone?: string
          sms_consent?: boolean
          sms_consent_at?: string | null
          sms_consent_source?: string | null
          sms_sendable?: boolean | null
          source?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          cadence_profile_id: string | null
          created_at: string
          currency: string
          customer_id: string
          external_ref: string | null
          id: string
          kind: Database["public"]["Enums"]["job_kind"]
          notes: string | null
          organization_id: string
          paid_at: string | null
          parent_job_id: string | null
          price_cents: number | null
          recurring_plan_id: string | null
          scheduled_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          cadence_profile_id?: string | null
          created_at?: string
          currency?: string
          customer_id: string
          external_ref?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["job_kind"]
          notes?: string | null
          organization_id: string
          paid_at?: string | null
          parent_job_id?: string | null
          price_cents?: number | null
          recurring_plan_id?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          cadence_profile_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          external_ref?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["job_kind"]
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          parent_job_id?: string | null
          price_cents?: number | null
          recurring_plan_id?: string | null
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_cadence_profile_id_fkey"
            columns: ["cadence_profile_id"]
            isOneToOne: false
            referencedRelation: "cadence_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_recurring_plan_id_fkey"
            columns: ["recurring_plan_id"]
            isOneToOne: false
            referencedRelation: "recurring_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          profile_id: string
          role: Database["public"]["Enums"]["membership_role"]
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          profile_id: string
          role?: Database["public"]["Enums"]["membership_role"]
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          profile_id?: string
          role?: Database["public"]["Enums"]["membership_role"]
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          stripe_account_id: string | null
          updated_at: string
          vertical_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          stripe_account_id?: string | null
          updated_at?: string
          vertical_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          stripe_account_id?: string | null
          updated_at?: string
          vertical_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_orgs_vertical"
            columns: ["vertical_id"]
            isOneToOne: false
            referencedRelation: "verticals"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      recurring_plans: {
        Row: {
          cadence_profile_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          created_at: string
          currency: string
          customer_id: string
          health_score: number | null
          id: string
          next_service_at: string | null
          organization_id: string
          origin_job_id: string | null
          paused_at: string | null
          price_cents: number
          risk_level: Database["public"]["Enums"]["plan_risk_level"]
          started_at: string | null
          status: Database["public"]["Enums"]["plan_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          cadence_profile_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          customer_id: string
          health_score?: number | null
          id?: string
          next_service_at?: string | null
          organization_id: string
          origin_job_id?: string | null
          paused_at?: string | null
          price_cents: number
          risk_level?: Database["public"]["Enums"]["plan_risk_level"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["plan_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          cadence_profile_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          health_score?: number | null
          id?: string
          next_service_at?: string | null
          organization_id?: string
          origin_job_id?: string | null
          paused_at?: string | null
          price_cents?: number
          risk_level?: Database["public"]["Enums"]["plan_risk_level"]
          started_at?: string | null
          status?: Database["public"]["Enums"]["plan_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_plans_cadence_profile_id_fkey"
            columns: ["cadence_profile_id"]
            isOneToOne: false
            referencedRelation: "cadence_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_plans_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_plans_origin_job_id_fkey"
            columns: ["origin_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_events: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          meta: Json
          occurred_at: string
          organization_id: string
          reason: string | null
          recurring_plan_id: string
          type: Database["public"]["Enums"]["retention_event_type"]
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          meta?: Json
          occurred_at?: string
          organization_id: string
          reason?: string | null
          recurring_plan_id: string
          type: Database["public"]["Enums"]["retention_event_type"]
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          meta?: Json
          occurred_at?: string
          organization_id?: string
          reason?: string | null
          recurring_plan_id?: string
          type?: Database["public"]["Enums"]["retention_event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "retention_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_events_recurring_plan_id_fkey"
            columns: ["recurring_plan_id"]
            isOneToOne: false
            referencedRelation: "recurring_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      verticals: {
        Row: {
          created_at: string
          default_cadence_id: string | null
          display_name: string
          id: string
          key: string
        }
        Insert: {
          created_at?: string
          default_cadence_id?: string | null
          display_name: string
          id?: string
          key: string
        }
        Update: {
          created_at?: string
          default_cadence_id?: string | null
          display_name?: string
          id?: string
          key?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_verticals_default_cadence"
            columns: ["default_cadence_id"]
            isOneToOne: false
            referencedRelation: "cadence_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_plan: {
        Args: {
          p_next_service_at?: string
          p_plan: string
          p_started_at?: string
          p_stripe_subscription_id?: string
        }
        Returns: {
          cadence_profile_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          created_at: string
          currency: string
          customer_id: string
          health_score: number | null
          id: string
          next_service_at: string | null
          organization_id: string
          origin_job_id: string | null
          paused_at: string | null
          price_cents: number
          risk_level: Database["public"]["Enums"]["plan_risk_level"]
          started_at: string | null
          status: Database["public"]["Enums"]["plan_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "recurring_plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      auth_org_ids: { Args: never; Returns: string[] }
      change_plan_status: {
        Args: {
          p_plan: string
          p_reason?: string
          p_status: Database["public"]["Enums"]["plan_status"]
        }
        Returns: {
          cadence_profile_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          created_at: string
          currency: string
          customer_id: string
          health_score: number | null
          id: string
          next_service_at: string | null
          organization_id: string
          origin_job_id: string | null
          paused_at: string | null
          price_cents: number
          risk_level: Database["public"]["Enums"]["plan_risk_level"]
          started_at: string | null
          status: Database["public"]["Enums"]["plan_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "recurring_plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_organization: {
        Args: { org_name: string; org_slug: string }
        Returns: string
      }
      create_recurring_plan: {
        Args: {
          p_cadence: string
          p_currency?: string
          p_customer: string
          p_org: string
          p_origin_job: string
          p_price_cents: number
        }
        Returns: {
          cadence_profile_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          created_at: string
          currency: string
          customer_id: string
          health_score: number | null
          id: string
          next_service_at: string | null
          organization_id: string
          origin_job_id: string | null
          paused_at: string | null
          price_cents: number
          risk_level: Database["public"]["Enums"]["plan_risk_level"]
          started_at: string | null
          status: Database["public"]["Enums"]["plan_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "recurring_plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_opted_out: { Args: { p_customer_id: string }; Returns: undefined }
    }
    Enums: {
      job_kind: "one_time" | "recurring"
      job_status: "scheduled" | "completed" | "cancelled" | "no_show"
      membership_role: "owner" | "staff"
      plan_risk_level: "none" | "low" | "medium" | "high"
      plan_status: "pending" | "active" | "paused" | "cancelled"
      retention_event_type:
        | "plan_created"
        | "activated"
        | "paused"
        | "resumed"
        | "churn_risk_flagged"
        | "save_offer_sent"
        | "save_offer_accepted"
        | "save_offer_declined"
        | "cancelled"
        | "winback_sent"
        | "winback_recovered"
        | "payment_failed"
        | "payment_recovered"
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
      job_kind: ["one_time", "recurring"],
      job_status: ["scheduled", "completed", "cancelled", "no_show"],
      membership_role: ["owner", "staff"],
      plan_risk_level: ["none", "low", "medium", "high"],
      plan_status: ["pending", "active", "paused", "cancelled"],
      retention_event_type: [
        "plan_created",
        "activated",
        "paused",
        "resumed",
        "churn_risk_flagged",
        "save_offer_sent",
        "save_offer_accepted",
        "save_offer_declined",
        "cancelled",
        "winback_sent",
        "winback_recovered",
        "payment_failed",
        "payment_recovered",
      ],
    },
  },
} as const
