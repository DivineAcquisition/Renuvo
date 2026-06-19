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
      calendar_connections: {
        Row: {
          access_token_enc: string | null
          calendar_id: string | null
          created_at: string
          enabled: boolean
          organization_id: string
          provider: string
          refresh_token_enc: string | null
          token_expiry: string | null
          updated_at: string
        }
        Insert: {
          access_token_enc?: string | null
          calendar_id?: string | null
          created_at?: string
          enabled?: boolean
          organization_id: string
          provider?: string
          refresh_token_enc?: string | null
          token_expiry?: string | null
          updated_at?: string
        }
        Update: {
          access_token_enc?: string | null
          calendar_id?: string | null
          created_at?: string
          enabled?: boolean
          organization_id?: string
          provider?: string
          refresh_token_enc?: string | null
          token_expiry?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
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
      events: {
        Row: {
          body: string | null
          channel: string | null
          created_at: string
          customer_id: string | null
          direction: Database["public"]["Enums"]["msg_direction"] | null
          external_id: string | null
          id: string
          job_id: string | null
          occurred_at: string
          organization_id: string
          payload: Json
          recurring_plan_id: string | null
          source: Database["public"]["Enums"]["event_source"]
          type: Database["public"]["Enums"]["event_type"]
          wallet_transaction_id: string | null
        }
        Insert: {
          body?: string | null
          channel?: string | null
          created_at?: string
          customer_id?: string | null
          direction?: Database["public"]["Enums"]["msg_direction"] | null
          external_id?: string | null
          id?: string
          job_id?: string | null
          occurred_at?: string
          organization_id: string
          payload?: Json
          recurring_plan_id?: string | null
          source: Database["public"]["Enums"]["event_source"]
          type: Database["public"]["Enums"]["event_type"]
          wallet_transaction_id?: string | null
        }
        Update: {
          body?: string | null
          channel?: string | null
          created_at?: string
          customer_id?: string | null
          direction?: Database["public"]["Enums"]["msg_direction"] | null
          external_id?: string | null
          id?: string
          job_id?: string | null
          occurred_at?: string
          organization_id?: string
          payload?: Json
          recurring_plan_id?: string | null
          source?: Database["public"]["Enums"]["event_source"]
          type?: Database["public"]["Enums"]["event_type"]
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_recurring_plan_id_fkey"
            columns: ["recurring_plan_id"]
            isOneToOne: false
            referencedRelation: "recurring_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_wallet_transaction_id_fkey"
            columns: ["wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          cadence_profile_id: string | null
          created_at: string
          currency: string
          customer_id: string | null
          external_ref: string | null
          id: string
          kind: Database["public"]["Enums"]["job_kind"]
          notes: string | null
          organization_id: string
          paid_at: string | null
          parent_job_id: string | null
          payment_external_id: string | null
          payment_source: string | null
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
          customer_id?: string | null
          external_ref?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["job_kind"]
          notes?: string | null
          organization_id: string
          paid_at?: string | null
          parent_job_id?: string | null
          payment_external_id?: string | null
          payment_source?: string | null
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
          customer_id?: string | null
          external_ref?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["job_kind"]
          notes?: string | null
          organization_id?: string
          paid_at?: string | null
          parent_job_id?: string | null
          payment_external_id?: string | null
          payment_source?: string | null
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
      message_templates: {
        Row: {
          body: string
          channel: string
          created_at: string
          event_key: Database["public"]["Enums"]["template_event_key"]
          id: string
          is_active: boolean
          organization_id: string | null
          updated_at: string
          vertical_id: string
        }
        Insert: {
          body: string
          channel?: string
          created_at?: string
          event_key: Database["public"]["Enums"]["template_event_key"]
          id?: string
          is_active?: boolean
          organization_id?: string | null
          updated_at?: string
          vertical_id: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          event_key?: Database["public"]["Enums"]["template_event_key"]
          id?: string
          is_active?: boolean
          organization_id?: string | null
          updated_at?: string
          vertical_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_templates_vertical_id_fkey"
            columns: ["vertical_id"]
            isOneToOne: false
            referencedRelation: "verticals"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          a2p_brand_id: string | null
          a2p_campaign_id: string | null
          a2p_status: Database["public"]["Enums"]["a2p_status"]
          created_at: string
          id: string
          ingest_secret: string
          name: string
          slug: string
          stripe_account_id: string | null
          telnyx_messaging_profile_id: string | null
          telnyx_phone_number: string | null
          updated_at: string
          vertical_id: string | null
        }
        Insert: {
          a2p_brand_id?: string | null
          a2p_campaign_id?: string | null
          a2p_status?: Database["public"]["Enums"]["a2p_status"]
          created_at?: string
          id?: string
          ingest_secret?: string
          name: string
          slug: string
          stripe_account_id?: string | null
          telnyx_messaging_profile_id?: string | null
          telnyx_phone_number?: string | null
          updated_at?: string
          vertical_id?: string | null
        }
        Update: {
          a2p_brand_id?: string | null
          a2p_campaign_id?: string | null
          a2p_status?: Database["public"]["Enums"]["a2p_status"]
          created_at?: string
          id?: string
          ingest_secret?: string
          name?: string
          slug?: string
          stripe_account_id?: string | null
          telnyx_messaging_profile_id?: string | null
          telnyx_phone_number?: string | null
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
      scheduled_messages: {
        Row: {
          attempts: number
          cancel_reason: string | null
          created_at: string
          customer_id: string
          event_key: Database["public"]["Enums"]["template_event_key"]
          id: string
          job_id: string | null
          last_error: string | null
          organization_id: string
          recurring_plan_id: string | null
          send_at: string
          status: Database["public"]["Enums"]["scheduled_msg_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          cancel_reason?: string | null
          created_at?: string
          customer_id: string
          event_key: Database["public"]["Enums"]["template_event_key"]
          id?: string
          job_id?: string | null
          last_error?: string | null
          organization_id: string
          recurring_plan_id?: string | null
          send_at: string
          status?: Database["public"]["Enums"]["scheduled_msg_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          cancel_reason?: string | null
          created_at?: string
          customer_id?: string
          event_key?: Database["public"]["Enums"]["template_event_key"]
          id?: string
          job_id?: string | null
          last_error?: string | null
          organization_id?: string
          recurring_plan_id?: string | null
          send_at?: string
          status?: Database["public"]["Enums"]["scheduled_msg_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_recurring_plan_id_fkey"
            columns: ["recurring_plan_id"]
            isOneToOne: false
            referencedRelation: "recurring_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_rates: {
        Row: {
          channel: string
          charge_cents_per_segment: number
          cost_microdollars_per_segment: number
          created_at: string
          effective_from: string
          id: string
          organization_id: string | null
        }
        Insert: {
          channel?: string
          charge_cents_per_segment: number
          cost_microdollars_per_segment: number
          created_at?: string
          effective_from?: string
          id?: string
          organization_id?: string | null
        }
        Update: {
          channel?: string
          charge_cents_per_segment?: number
          cost_microdollars_per_segment?: number
          created_at?: string
          effective_from?: string
          id?: string
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      wallet_transactions: {
        Row: {
          amount_cents: number
          balance_after_cents: number
          charge_cents: number | null
          cost_microdollars: number | null
          created_at: string
          id: string
          margin_microdollars: number | null
          meta: Json
          organization_id: string
          reference: string | null
          segments: number | null
          type: Database["public"]["Enums"]["wallet_txn_type"]
        }
        Insert: {
          amount_cents: number
          balance_after_cents: number
          charge_cents?: number | null
          cost_microdollars?: number | null
          created_at?: string
          id?: string
          margin_microdollars?: number | null
          meta?: Json
          organization_id: string
          reference?: string | null
          segments?: number | null
          type: Database["public"]["Enums"]["wallet_txn_type"]
        }
        Update: {
          amount_cents?: number
          balance_after_cents?: number
          charge_cents?: number | null
          cost_microdollars?: number | null
          created_at?: string
          id?: string
          margin_microdollars?: number | null
          meta?: Json
          organization_id?: string
          reference?: string | null
          segments?: number | null
          type?: Database["public"]["Enums"]["wallet_txn_type"]
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          auto_reload_enabled: boolean
          balance_cents: number
          created_at: string
          low_balance_notified_at: string | null
          organization_id: string
          reload_amount_cents: number
          reload_threshold_cents: number
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          updated_at: string
        }
        Insert: {
          auto_reload_enabled?: boolean
          balance_cents?: number
          created_at?: string
          low_balance_notified_at?: string | null
          organization_id: string
          reload_amount_cents?: number
          reload_threshold_cents?: number
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_reload_enabled?: boolean
          balance_cents?: number
          created_at?: string
          low_balance_notified_at?: string | null
          organization_id?: string
          reload_amount_cents?: number
          reload_threshold_cents?: number
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
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
      credit_wallet: {
        Args: {
          p_amount_cents: number
          p_meta?: Json
          p_org_id: string
          p_reference?: string
          p_type?: Database["public"]["Enums"]["wallet_txn_type"]
        }
        Returns: Json
      }
      debit_wallet: {
        Args: {
          p_meta?: Json
          p_org_id: string
          p_reference?: string
          p_segments: number
        }
        Returns: Json
      }
      get_calendar_status: {
        Args: { p_org_id: string }
        Returns: {
          calendar_id: string
          connected: boolean
          enabled: boolean
        }[]
      }
      mark_opted_out: { Args: { p_customer_id: string }; Returns: undefined }
      record_event: {
        Args: {
          p_body?: string
          p_channel?: string
          p_customer_id?: string
          p_direction?: Database["public"]["Enums"]["msg_direction"]
          p_external_id?: string
          p_job_id?: string
          p_org_id: string
          p_payload?: Json
          p_plan_id?: string
          p_source: Database["public"]["Enums"]["event_source"]
          p_type: Database["public"]["Enums"]["event_type"]
          p_wallet_txn_id?: string
        }
        Returns: string
      }
      resolve_charge_rate: {
        Args: { p_channel?: string; p_org_id: string }
        Returns: {
          charge_cents: number
          cost_microdollars: number
        }[]
      }
      resolve_template: {
        Args: {
          p_event_key: Database["public"]["Enums"]["template_event_key"]
          p_org_id: string
          p_vertical_id: string
        }
        Returns: string
      }
      update_wallet_settings: {
        Args: {
          p_auto_reload_enabled: boolean
          p_org_id: string
          p_reload_amount: number
          p_reload_threshold: number
        }
        Returns: undefined
      }
    }
    Enums: {
      a2p_status: "not_started" | "pending" | "approved" | "rejected"
      event_source: "stripe" | "telnyx" | "agent" | "system" | "app"
      event_type:
        | "payment_succeeded"
        | "payment_refunded"
        | "message_sent"
        | "message_delivered"
        | "message_failed"
        | "reply_received"
        | "activation_sent"
        | "conversion_offer_sent"
        | "recurring_booked"
        | "opted_out"
        | "scheduled_message_queued"
        | "agent_action"
      job_kind: "one_time" | "recurring"
      job_status: "scheduled" | "completed" | "cancelled" | "no_show"
      membership_role: "owner" | "staff"
      msg_direction: "outbound" | "inbound"
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
      scheduled_msg_status:
        | "pending"
        | "sent"
        | "cancelled"
        | "skipped"
        | "failed"
      template_event_key:
        | "post_payment_activation"
        | "conversion_offer"
        | "reminder"
        | "objection_followup"
        | "recurring_confirmation"
        | "winback"
        | "save_offer"
      wallet_txn_type:
        | "credit_reload"
        | "credit_manual"
        | "credit_refund"
        | "debit_sms"
        | "debit_adjustment"
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
      a2p_status: ["not_started", "pending", "approved", "rejected"],
      event_source: ["stripe", "telnyx", "agent", "system", "app"],
      event_type: [
        "payment_succeeded",
        "payment_refunded",
        "message_sent",
        "message_delivered",
        "message_failed",
        "reply_received",
        "activation_sent",
        "conversion_offer_sent",
        "recurring_booked",
        "opted_out",
        "scheduled_message_queued",
        "agent_action",
      ],
      job_kind: ["one_time", "recurring"],
      job_status: ["scheduled", "completed", "cancelled", "no_show"],
      membership_role: ["owner", "staff"],
      msg_direction: ["outbound", "inbound"],
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
      scheduled_msg_status: [
        "pending",
        "sent",
        "cancelled",
        "skipped",
        "failed",
      ],
      template_event_key: [
        "post_payment_activation",
        "conversion_offer",
        "reminder",
        "objection_followup",
        "recurring_confirmation",
        "winback",
        "save_offer",
      ],
      wallet_txn_type: [
        "credit_reload",
        "credit_manual",
        "credit_refund",
        "debit_sms",
        "debit_adjustment",
      ],
    },
  },
} as const
