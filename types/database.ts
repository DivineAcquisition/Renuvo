export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name?: string;
          slug: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      organization_members: {
        Row: {
          organization_id: string;
          user_id: string;
          role: "owner" | "member";
          created_at: string;
        };
        Insert: {
          organization_id: string;
          user_id: string;
          role?: "owner" | "member";
          created_at?: string;
        };
        Update: {
          organization_id?: string;
          user_id?: string;
          role?: "owner" | "member";
          created_at?: string;
        };
        Relationships: [];
      };
      inboxes: {
        Row: {
          id: string;
          organization_id: string;
          address_local: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          address_local: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          address_local?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
