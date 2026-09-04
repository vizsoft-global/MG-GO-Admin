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
    PostgrestVersion: "14.17"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_activity_logs: {
        Row: {
          action: Database["public"]["Enums"]["admin_activity_action"]
          admin_role_slug: string | null
          admin_user_id: string | null
          after_state: Json | null
          before_state: Json | null
          changed_fields: string[]
          context: Json
          created_at: string
          entity_id: string | null
          entity_type: string | null
          error_message: string | null
          id: string
          ip_address: string | null
          page_path: string | null
          route_name: string | null
          success: boolean
          user_agent: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["admin_activity_action"]
          admin_role_slug?: string | null
          admin_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          changed_fields?: string[]
          context?: Json
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          id?: string
          ip_address?: string | null
          page_path?: string | null
          route_name?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["admin_activity_action"]
          admin_role_slug?: string | null
          admin_user_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          changed_fields?: string[]
          context?: Json
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          id?: string
          ip_address?: string | null
          page_path?: string | null
          route_name?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Relationships: []
      }
      driver_change_events: {
        Row: {
          actor_id: string
          actor_name: string
          changes: Json
          context: Json
          created_at: string
          driver_id: string | null
          id: string
          intake_id: string
          source: string
        }
        Insert: {
          actor_id: string
          actor_name: string
          changes?: Json
          context?: Json
          created_at?: string
          driver_id?: string | null
          id?: string
          intake_id: string
          source: string
        }
        Update: {
          actor_id?: string
          actor_name?: string
          changes?: Json
          context?: Json
          created_at?: string
          driver_id?: string | null
          id?: string
          intake_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_change_events_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "driver_intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_change_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_allowlist: {
        Row: {
          created_at: string
          email: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          email: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          email?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      admin_permissions: {
        Row: {
          category: string
          label: string
          slug: string
        }
        Insert: {
          category?: string
          label: string
          slug: string
        }
        Update: {
          category?: string
          label?: string
          slug?: string
        }
        Relationships: []
      }
      admin_role_permissions: {
        Row: {
          permission_slug: string
          role_id: string
        }
        Insert: {
          permission_slug: string
          role_id: string
        }
        Update: {
          permission_slug?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_role_permissions_permission_slug_fkey"
            columns: ["permission_slug"]
            isOneToOne: false
            referencedRelation: "admin_permissions"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "admin_role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "admin_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_role_ui_defaults: {
        Row: {
          preference_key: string
          role_id: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          preference_key: string
          role_id: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          preference_key?: string
          role_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "admin_role_ui_defaults_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "admin_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_roles: {
        Row: {
          created_at: string
          id: string
          is_super_admin: boolean
          is_system: boolean
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_super_admin?: boolean
          is_system?: boolean
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          is_super_admin?: boolean
          is_system?: boolean
          name?: string
          slug?: string
        }
        Relationships: []
      }
      admin_ui_preferences: {
        Row: {
          preference_key: string
          updated_at: string
          user_id: string
          value: Json
        }
        Insert: {
          preference_key: string
          updated_at?: string
          user_id: string
          value?: Json
        }
        Update: {
          preference_key?: string
          updated_at?: string
          user_id?: string
          value?: Json
        }
        Relationships: []
      }
      app_page_registry: {
        Row: {
          admin_permission: string | null
          admin_route: string | null
          admin_sidebar_id: string | null
          created_at: string
          description: string | null
          driver_bottom_nav: string | null
          driver_route: string | null
          id: string
          key_columns: Json
          logic_summary: string | null
          page_key: string
          page_title: string
          platform: string
          realtime_channels: string[]
          rls_notes: string | null
          sort_order: number
          status_flow: Json | null
          storage_buckets: string[]
          tables_read: string[]
          tables_write: string[]
          updated_at: string
        }
        Insert: {
          admin_permission?: string | null
          admin_route?: string | null
          admin_sidebar_id?: string | null
          created_at?: string
          description?: string | null
          driver_bottom_nav?: string | null
          driver_route?: string | null
          id?: string
          key_columns?: Json
          logic_summary?: string | null
          page_key: string
          page_title: string
          platform: string
          realtime_channels?: string[]
          rls_notes?: string | null
          sort_order?: number
          status_flow?: Json | null
          storage_buckets?: string[]
          tables_read?: string[]
          tables_write?: string[]
          updated_at?: string
        }
        Update: {
          admin_permission?: string | null
          admin_route?: string | null
          admin_sidebar_id?: string | null
          created_at?: string
          description?: string | null
          driver_bottom_nav?: string | null
          driver_route?: string | null
          id?: string
          key_columns?: Json
          logic_summary?: string | null
          page_key?: string
          page_title?: string
          platform?: string
          realtime_channels?: string[]
          rls_notes?: string | null
          sort_order?: number
          status_flow?: Json | null
          storage_buckets?: string[]
          tables_read?: string[]
          tables_write?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      app_releases: {
        Row: {
          apk_object_key: string
          apk_sha256: string
          apk_size_bytes: number
          channel: string
          id: string
          is_active: boolean
          is_required: boolean
          min_supported_version_code: number | null
          platform: string
          release_notes: string | null
          released_at: string
          released_by: string | null
          version_code: number
          version_name: string
        }
        Insert: {
          apk_object_key: string
          apk_sha256: string
          apk_size_bytes: number
          channel?: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          min_supported_version_code?: number | null
          platform?: string
          release_notes?: string | null
          released_at?: string
          released_by?: string | null
          version_code: number
          version_name: string
        }
        Update: {
          apk_object_key?: string
          apk_sha256?: string
          apk_size_bytes?: number
          channel?: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          min_supported_version_code?: number | null
          platform?: string
          release_notes?: string | null
          released_at?: string
          released_by?: string | null
          version_code?: number
          version_name?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          app_name: string
          app_subtitle: string
          attendance_auto_checkout_minutes: number
          attendance_early_out_grace_minutes: number
          attendance_gps_min_accuracy_meters: number
          attendance_gps_stale_minutes: number
          attendance_late_grace_minutes: number
          attendance_offline_alert_minutes: number
          delivery_ontime_minutes: number
          driver_app_delivery_proximity_meters: number
          driver_app_force_update: boolean
          driver_app_icon_url: string | null
          driver_app_login_hint: string
          driver_app_login_verification_exempt_all: boolean
          driver_app_logo_url: string | null
          driver_app_maintenance_message: string
          driver_app_maintenance_mode: boolean
          driver_app_min_version_code: number | null
          driver_app_min_version_name: string | null
          driver_app_sideload_updates_enabled: boolean
          driver_app_splash_url: string | null
          driver_app_title: string
          driver_app_update_message: string | null
          driver_location_events_retention_days: number
          driver_location_rpc_min_interval_seconds: number
          driver_ops_log_retention_days: number
          driver_telemetry_max_events_per_hour: number
          driver_telemetry_retention_days: number
          esign_screenshot_default: boolean
          feature_two_stage_delivery: boolean
          fleet_events_retention_days: number
          fleet_gps_offline_seconds: number
          fleet_idle_minutes: number
          fleet_low_battery_pct: number
          fleet_overspeed_kmh: number
          fleet_shift_late_grace_minutes: number
          fleet_stale_gps_seconds: number
          fleet_zone_buffer_meters: number
          font_family: string
          id: number
          logo_type: string
          logo_url: string | null
          maintenance_mode: boolean
          performance_conduct_allowance_per_day: number
          performance_score_weights: Json
          performance_speed_allowance_per_day: number
          pickup_auto_cancel_hours: number
          request_auto_close_days: number
          super_admin_claimed: boolean
          super_admin_user_id: string | null
          theme_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          app_name?: string
          app_subtitle?: string
          attendance_auto_checkout_minutes?: number
          attendance_early_out_grace_minutes?: number
          attendance_gps_min_accuracy_meters?: number
          attendance_gps_stale_minutes?: number
          attendance_late_grace_minutes?: number
          attendance_offline_alert_minutes?: number
          delivery_ontime_minutes?: number
          driver_app_delivery_proximity_meters?: number
          driver_app_force_update?: boolean
          driver_app_icon_url?: string | null
          driver_app_login_hint?: string
          driver_app_login_verification_exempt_all?: boolean
          driver_app_logo_url?: string | null
          driver_app_maintenance_message?: string
          driver_app_maintenance_mode?: boolean
          driver_app_min_version_code?: number | null
          driver_app_min_version_name?: string | null
          driver_app_sideload_updates_enabled?: boolean
          driver_app_splash_url?: string | null
          driver_app_title?: string
          driver_app_update_message?: string | null
          driver_location_events_retention_days?: number
          driver_location_rpc_min_interval_seconds?: number
          driver_ops_log_retention_days?: number
          driver_telemetry_max_events_per_hour?: number
          driver_telemetry_retention_days?: number
          esign_screenshot_default?: boolean
          feature_two_stage_delivery?: boolean
          fleet_events_retention_days?: number
          fleet_gps_offline_seconds?: number
          fleet_idle_minutes?: number
          fleet_low_battery_pct?: number
          fleet_overspeed_kmh?: number
          fleet_shift_late_grace_minutes?: number
          fleet_stale_gps_seconds?: number
          fleet_zone_buffer_meters?: number
          font_family?: string
          id?: number
          logo_type?: string
          logo_url?: string | null
          maintenance_mode?: boolean
          performance_conduct_allowance_per_day?: number
          performance_score_weights?: Json
          performance_speed_allowance_per_day?: number
          pickup_auto_cancel_hours?: number
          request_auto_close_days?: number
          super_admin_claimed?: boolean
          super_admin_user_id?: string | null
          theme_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          app_name?: string
          app_subtitle?: string
          attendance_auto_checkout_minutes?: number
          attendance_early_out_grace_minutes?: number
          attendance_gps_min_accuracy_meters?: number
          attendance_gps_stale_minutes?: number
          attendance_late_grace_minutes?: number
          attendance_offline_alert_minutes?: number
          delivery_ontime_minutes?: number
          driver_app_delivery_proximity_meters?: number
          driver_app_force_update?: boolean
          driver_app_icon_url?: string | null
          driver_app_login_hint?: string
          driver_app_login_verification_exempt_all?: boolean
          driver_app_logo_url?: string | null
          driver_app_maintenance_message?: string
          driver_app_maintenance_mode?: boolean
          driver_app_min_version_code?: number | null
          driver_app_min_version_name?: string | null
          driver_app_sideload_updates_enabled?: boolean
          driver_app_splash_url?: string | null
          driver_app_title?: string
          driver_app_update_message?: string | null
          driver_location_events_retention_days?: number
          driver_location_rpc_min_interval_seconds?: number
          driver_ops_log_retention_days?: number
          driver_telemetry_max_events_per_hour?: number
          driver_telemetry_retention_days?: number
          esign_screenshot_default?: boolean
          feature_two_stage_delivery?: boolean
          fleet_events_retention_days?: number
          fleet_gps_offline_seconds?: number
          fleet_idle_minutes?: number
          fleet_low_battery_pct?: number
          fleet_overspeed_kmh?: number
          fleet_shift_late_grace_minutes?: number
          fleet_stale_gps_seconds?: number
          fleet_zone_buffer_meters?: number
          font_family?: string
          id?: number
          logo_type?: string
          logo_url?: string | null
          maintenance_mode?: boolean
          performance_conduct_allowance_per_day?: number
          performance_score_weights?: Json
          performance_speed_allowance_per_day?: number
          pickup_auto_cancel_hours?: number
          request_auto_close_days?: number
          super_admin_claimed?: boolean
          super_admin_user_id?: string | null
          theme_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      app_themes: {
        Row: {
          base_preset: string
          created_at: string
          dark_tokens: Json
          id: string
          light_tokens: Json
          name: string
          updated_at: string
        }
        Insert: {
          base_preset?: string
          created_at?: string
          dark_tokens?: Json
          id: string
          light_tokens?: Json
          name: string
          updated_at?: string
        }
        Update: {
          base_preset?: string
          created_at?: string
          dark_tokens?: Json
          id?: string
          light_tokens?: Json
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      appointment_slots: {
        Row: {
          capacity: number
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          slot_name: string
          start_time: string
          updated_at: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          slot_name: string
          start_time: string
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          slot_name?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          admin_note: string | null
          appointment_code: string | null
          created_at: string
          created_by: string | null
          driver_id: string
          driver_response_note: string | null
          id: string
          location_label: string | null
          proposed_for: string | null
          reason: string | null
          responded_at: string | null
          scheduled_for: string
          slot_id: string
          status: Database["public"]["Enums"]["appointment_status"]
          title: string | null
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          appointment_code?: string | null
          created_at?: string
          created_by?: string | null
          driver_id: string
          driver_response_note?: string | null
          id?: string
          location_label?: string | null
          proposed_for?: string | null
          reason?: string | null
          responded_at?: string | null
          scheduled_for: string
          slot_id: string
          status?: Database["public"]["Enums"]["appointment_status"]
          title?: string | null
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          appointment_code?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string
          driver_response_note?: string | null
          id?: string
          location_label?: string | null
          proposed_for?: string | null
          reason?: string | null
          responded_at?: string | null
          scheduled_for?: string
          slot_id?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "appointment_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          catalog_item_id: string
          created_at: string
          driver_id: string | null
          id: string
          intake_id: string | null
          notes: string | null
          quantity: number
          returned_at: string | null
          status: Database["public"]["Enums"]["asset_assignment_status"]
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          catalog_item_id: string
          created_at?: string
          driver_id?: string | null
          id?: string
          intake_id?: string | null
          notes?: string | null
          quantity?: number
          returned_at?: string | null
          status?: Database["public"]["Enums"]["asset_assignment_status"]
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          catalog_item_id?: string
          created_at?: string
          driver_id?: string | null
          id?: string
          intake_id?: string | null
          notes?: string | null
          quantity?: number
          returned_at?: string | null
          status?: Database["public"]["Enums"]["asset_assignment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_assignments_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "asset_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_assignments_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "driver_intakes"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_catalog: {
        Row: {
          category: string | null
          code: string
          created_at: string
          description: string | null
          icon_key: string
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          penalty_kwd: number | null
          reorder_level: number
          total_quantity: number
          updated_at: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          description?: string | null
          icon_key?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          penalty_kwd?: number | null
          reorder_level?: number
          total_quantity?: number
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          description?: string | null
          icon_key?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          penalty_kwd?: number | null
          reorder_level?: number
          total_quantity?: number
          updated_at?: string
        }
        Relationships: []
      }
      attendance_exception_actions: {
        Row: {
          action: string | null
          created_at: string
          driver_id: string
          exception_date: string
          exception_key: string
          exception_type: string
          id: string
          note: string | null
          resolution_status: string
          supervisor_id: string | null
          updated_at: string
        }
        Insert: {
          action?: string | null
          created_at?: string
          driver_id: string
          exception_date: string
          exception_key: string
          exception_type: string
          id?: string
          note?: string | null
          resolution_status?: string
          supervisor_id?: string | null
          updated_at?: string
        }
        Update: {
          action?: string | null
          created_at?: string
          driver_id?: string
          exception_date?: string
          exception_key?: string
          exception_type?: string
          id?: string
          note?: string | null
          resolution_status?: string
          supervisor_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_exception_actions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_exception_actions_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_logs: {
        Row: {
          admin_note: string | null
          check_in_at: string | null
          check_out_at: string | null
          check_out_reason: string | null
          created_at: string
          distance_meters: number | null
          driver_id: string
          id: string
          log_date: string
          status: Database["public"]["Enums"]["attendance_status"]
          updated_at: string
          zone_compliance: Database["public"]["Enums"]["zone_compliance"] | null
        }
        Insert: {
          admin_note?: string | null
          check_in_at?: string | null
          check_out_at?: string | null
          check_out_reason?: string | null
          created_at?: string
          distance_meters?: number | null
          driver_id: string
          id?: string
          log_date: string
          status?: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
          zone_compliance?:
            | Database["public"]["Enums"]["zone_compliance"]
            | null
        }
        Update: {
          admin_note?: string | null
          check_in_at?: string | null
          check_out_at?: string | null
          check_out_reason?: string | null
          created_at?: string
          distance_meters?: number | null
          driver_id?: string
          id?: string
          log_date?: string
          status?: Database["public"]["Enums"]["attendance_status"]
          updated_at?: string
          zone_compliance?:
            | Database["public"]["Enums"]["zone_compliance"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_logs_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      complaint_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key: string
          label_ar: string | null
          label_en: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          label_ar?: string | null
          label_en: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          label_ar?: string | null
          label_en?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      custom_field_definitions: {
        Row: {
          archived_at: string | null
          created_at: string
          default_value: Json | null
          entity_type: string
          field_type: string
          id: string
          is_active: boolean
          key: string
          label: string
          letters_only: boolean
          options: Json
          required: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          default_value?: Json | null
          entity_type: string
          field_type: string
          id?: string
          is_active?: boolean
          key: string
          label: string
          letters_only?: boolean
          options?: Json
          required?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          default_value?: Json | null
          entity_type?: string
          field_type?: string
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          letters_only?: boolean
          options?: Json
          required?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      deliveries: {
        Row: {
          cancel_lat: number | null
          cancel_lng: number | null
          cancel_proof_url: string | null
          cancel_proof_urls: string[]
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          delivered_lat: number | null
          delivered_lng: number | null
          driver_id: string
          external_order_id: string | null
          id: string
          order_proof_url: string | null
          order_proof_urls: string[]
          partner_id: string | null
          pickup_at: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_proof_url: string | null
          pickup_proof_urls: string[]
          rejection_reason: string | null
          restaurant_id: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          cancel_lat?: number | null
          cancel_lng?: number | null
          cancel_proof_url?: string | null
          cancel_proof_urls?: string[]
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivered_lat?: number | null
          delivered_lng?: number | null
          driver_id: string
          external_order_id?: string | null
          id?: string
          order_proof_url?: string | null
          order_proof_urls?: string[]
          partner_id?: string | null
          pickup_at?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_proof_url?: string | null
          pickup_proof_urls?: string[]
          rejection_reason?: string | null
          restaurant_id?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          cancel_lat?: number | null
          cancel_lng?: number | null
          cancel_proof_url?: string | null
          cancel_proof_urls?: string[]
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivered_lat?: number | null
          delivered_lng?: number | null
          driver_id?: string
          external_order_id?: string | null
          id?: string
          order_proof_url?: string | null
          order_proof_urls?: string[]
          partner_id?: string | null
          pickup_at?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_proof_url?: string | null
          pickup_proof_urls?: string[]
          rejection_reason?: string | null
          restaurant_id?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_rule_scopes: {
        Row: {
          created_at: string
          delivery_rule_id: string
          id: string
          partner_id: string | null
          restaurant_id: string | null
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          delivery_rule_id: string
          id?: string
          partner_id?: string | null
          restaurant_id?: string | null
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          delivery_rule_id?: string
          id?: string
          partner_id?: string | null
          restaurant_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_rule_scopes_delivery_rule_id_fkey"
            columns: ["delivery_rule_id"]
            isOneToOne: false
            referencedRelation: "delivery_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_rule_scopes_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_rule_scopes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_rule_scopes_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_rules: {
        Row: {
          created_at: string
          end_date: string
          id: string
          must_match_driver_zone: boolean
          must_match_partner: boolean
          name: string
          partner_id: string | null
          priority: number
          require_verified: boolean
          restaurant_id: string | null
          scope_type: Database["public"]["Enums"]["rule_scope_type"]
          start_date: string
          status: Database["public"]["Enums"]["rule_status"]
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          must_match_driver_zone?: boolean
          must_match_partner?: boolean
          name: string
          partner_id?: string | null
          priority?: number
          require_verified?: boolean
          restaurant_id?: string | null
          scope_type: Database["public"]["Enums"]["rule_scope_type"]
          start_date: string
          status?: Database["public"]["Enums"]["rule_status"]
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          must_match_driver_zone?: boolean
          must_match_partner?: boolean
          name?: string
          partner_id?: string | null
          priority?: number
          require_verified?: boolean
          restaurant_id?: string | null
          scope_type?: Database["public"]["Enums"]["rule_scope_type"]
          start_date?: string
          status?: Database["public"]["Enums"]["rule_status"]
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_rules_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_rules_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_rules_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_sla_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          minutes: number
          scope_id: string
          scope_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          minutes: number
          scope_id: string
          scope_type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          minutes?: number
          scope_id?: string
          scope_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_sla_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_verifications: {
        Row: {
          created_at: string
          created_by: string | null
          driver_id: string
          id: string
          import_batch_id: string | null
          matched_count: number
          notes: string | null
          partner_id: string
          reconciled_at: string | null
          reported_count: number
          restaurant_id: string
          service_date: string
          shortfall_count: number
          source: Database["public"]["Enums"]["verification_source"]
          status: Database["public"]["Enums"]["verification_status"]
          under_review_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          driver_id: string
          id?: string
          import_batch_id?: string | null
          matched_count?: number
          notes?: string | null
          partner_id: string
          reconciled_at?: string | null
          reported_count: number
          restaurant_id: string
          service_date: string
          shortfall_count?: number
          source?: Database["public"]["Enums"]["verification_source"]
          status?: Database["public"]["Enums"]["verification_status"]
          under_review_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          driver_id?: string
          id?: string
          import_batch_id?: string | null
          matched_count?: number
          notes?: string | null
          partner_id?: string
          reconciled_at?: string | null
          reported_count?: number
          restaurant_id?: string
          service_date?: string
          shortfall_count?: number
          source?: Database["public"]["Enums"]["verification_source"]
          status?: Database["public"]["Enums"]["verification_status"]
          under_review_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_verifications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_verifications_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_verifications_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "verification_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_verifications_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_verifications_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_tracking: {
        Row: {
          created_at: string
          doc_type: Database["public"]["Enums"]["document_type"]
          driver_id: string | null
          expires_at: string | null
          id: string
          intake_id: string | null
          notify_enabled: boolean
          notify_lead_days: number[]
          object_key: string | null
          track_expiry: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          doc_type: Database["public"]["Enums"]["document_type"]
          driver_id?: string | null
          expires_at?: string | null
          id?: string
          intake_id?: string | null
          notify_enabled?: boolean
          notify_lead_days?: number[]
          object_key?: string | null
          track_expiry?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          doc_type?: Database["public"]["Enums"]["document_type"]
          driver_id?: string | null
          expires_at?: string | null
          id?: string
          intake_id?: string | null
          notify_enabled?: boolean
          notify_lead_days?: number[]
          object_key?: string | null
          track_expiry?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_tracking_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_tracking_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "driver_intakes"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_app_version_history: {
        Row: {
          changed_at: string
          channel: string | null
          driver_id: string
          id: string
          platform: string
          version_code: number
          version_name: string | null
        }
        Insert: {
          changed_at?: string
          channel?: string | null
          driver_id: string
          id?: string
          platform: string
          version_code: number
          version_name?: string | null
        }
        Update: {
          changed_at?: string
          channel?: string | null
          driver_id?: string
          id?: string
          platform?: string
          version_code?: number
          version_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_app_version_history_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_assets: {
        Row: {
          asset: Database["public"]["Enums"]["asset_type"]
          created_at: string
          driver_id: string
          id: string
          issued: boolean
          updated_at: string
        }
        Insert: {
          asset: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          driver_id: string
          id?: string
          issued?: boolean
          updated_at?: string
        }
        Update: {
          asset?: Database["public"]["Enums"]["asset_type"]
          created_at?: string
          driver_id?: string
          id?: string
          issued?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_assets_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_assignment_events: {
        Row: {
          change_type: string
          changed_by: string | null
          context_entity_id: string | null
          context_entity_type: string | null
          created_at: string
          driver_id: string
          id: string
          restaurant_ids_after: string[]
          restaurant_ids_before: string[]
          zone_id_after: string | null
          zone_id_before: string | null
        }
        Insert: {
          change_type: string
          changed_by?: string | null
          context_entity_id?: string | null
          context_entity_type?: string | null
          created_at?: string
          driver_id: string
          id?: string
          restaurant_ids_after?: string[]
          restaurant_ids_before?: string[]
          zone_id_after?: string | null
          zone_id_before?: string | null
        }
        Update: {
          change_type?: string
          changed_by?: string | null
          context_entity_id?: string | null
          context_entity_type?: string | null
          created_at?: string
          driver_id?: string
          id?: string
          restaurant_ids_after?: string[]
          restaurant_ids_before?: string[]
          zone_id_after?: string | null
          zone_id_before?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_assignment_events_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_assignment_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_assignment_events_zone_id_after_fkey"
            columns: ["zone_id_after"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_assignment_events_zone_id_before_fkey"
            columns: ["zone_id_before"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_attendance: {
        Row: {
          attendance_date: string
          corrected_at: string | null
          corrected_by: string | null
          created_at: string
          driver_id: string
          first_online_at: string | null
          id: string
          is_manual: boolean
          is_validated: boolean
          last_online_at: string | null
          manual_reason: string | null
          online_seconds: number
          status: string
          total_ping_count: number
          updated_at: string
          valid_ping_count: number
          validated_at: string | null
          validation_ref_id: string | null
          validation_source: string | null
        }
        Insert: {
          attendance_date: string
          corrected_at?: string | null
          corrected_by?: string | null
          created_at?: string
          driver_id: string
          first_online_at?: string | null
          id?: string
          is_manual?: boolean
          is_validated?: boolean
          last_online_at?: string | null
          manual_reason?: string | null
          online_seconds?: number
          status?: string
          total_ping_count?: number
          updated_at?: string
          valid_ping_count?: number
          validated_at?: string | null
          validation_ref_id?: string | null
          validation_source?: string | null
        }
        Update: {
          attendance_date?: string
          corrected_at?: string | null
          corrected_by?: string | null
          created_at?: string
          driver_id?: string
          first_online_at?: string | null
          id?: string
          is_manual?: boolean
          is_validated?: boolean
          last_online_at?: string | null
          manual_reason?: string | null
          online_seconds?: number
          status?: string
          total_ping_count?: number
          updated_at?: string
          valid_ping_count?: number
          validated_at?: string | null
          validation_ref_id?: string | null
          validation_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_attendance_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_daily_shifts: {
        Row: {
          created_at: string
          driver_id: string
          id: string
          session1_end: string
          session1_end_day_offset: number
          session1_start: string
          session2_end: string | null
          session2_end_day_offset: number
          session2_start: string | null
          session2_start_day_offset: number
          shift_date: string
          shift_type: string
          submitted_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          id?: string
          session1_end: string
          session1_end_day_offset?: number
          session1_start: string
          session2_end?: string | null
          session2_end_day_offset?: number
          session2_start?: string | null
          session2_start_day_offset?: number
          shift_date: string
          shift_type: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          id?: string
          session1_end?: string
          session1_end_day_offset?: number
          session1_start?: string
          session2_end?: string | null
          session2_end_day_offset?: number
          session2_start?: string | null
          session2_start_day_offset?: number
          shift_date?: string
          shift_type?: string
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_daily_shifts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_device_sessions: {
        Row: {
          android_sdk_int: number | null
          app_version_code: number | null
          app_version_name: string | null
          created_at: string
          device_id: string
          device_manufacturer: string | null
          device_model: string | null
          driver_id: string
          first_seen_at: string
          flush_deadline_at: string | null
          flushed_at: string | null
          id: string
          last_seen_at: string
          os_version: string | null
          revoked_at: string | null
          revoked_reason: string | null
          updated_at: string
        }
        Insert: {
          android_sdk_int?: number | null
          app_version_code?: number | null
          app_version_name?: string | null
          created_at?: string
          device_id: string
          device_manufacturer?: string | null
          device_model?: string | null
          driver_id: string
          first_seen_at?: string
          flush_deadline_at?: string | null
          flushed_at?: string | null
          id?: string
          last_seen_at?: string
          os_version?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          updated_at?: string
        }
        Update: {
          android_sdk_int?: number | null
          app_version_code?: number | null
          app_version_name?: string | null
          created_at?: string
          device_id?: string
          device_manufacturer?: string | null
          device_model?: string | null
          driver_id?: string
          first_seen_at?: string
          flush_deadline_at?: string | null
          flushed_at?: string | null
          id?: string
          last_seen_at?: string
          os_version?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_device_sessions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_documents: {
        Row: {
          created_at: string
          doc_type: Database["public"]["Enums"]["document_type"]
          driver_id: string
          expires_at: string | null
          file_url: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          doc_type: Database["public"]["Enums"]["document_type"]
          driver_id: string
          expires_at?: string | null
          file_url: string
          id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          doc_type?: Database["public"]["Enums"]["document_type"]
          driver_id?: string
          expires_at?: string | null
          file_url?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_documents_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_earnings_daily: {
        Row: {
          base_kwd: number
          breakdown: Json
          calculated_at: string | null
          created_at: string
          deliveries: number
          driver_id: string
          earn_date: string
          id: string
          incentive_kwd: number
          loan_deduction_kwd: number
          net_kwd: number
          penalty_kwd: number
          reimbursement_kwd: number
          updated_at: string
        }
        Insert: {
          base_kwd?: number
          breakdown?: Json
          calculated_at?: string | null
          created_at?: string
          deliveries?: number
          driver_id: string
          earn_date: string
          id?: string
          incentive_kwd?: number
          loan_deduction_kwd?: number
          net_kwd?: number
          penalty_kwd?: number
          reimbursement_kwd?: number
          updated_at?: string
        }
        Update: {
          base_kwd?: number
          breakdown?: Json
          calculated_at?: string | null
          created_at?: string
          deliveries?: number
          driver_id?: string
          earn_date?: string
          id?: string
          incentive_kwd?: number
          loan_deduction_kwd?: number
          net_kwd?: number
          penalty_kwd?: number
          reimbursement_kwd?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_earnings_daily_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_group_members: {
        Row: {
          created_at: string
          driver_id: string
          group_id: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          group_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_group_members_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "driver_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_groups: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          icon_key: string | null
          id: string
          member_count: number
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon_key?: string | null
          id?: string
          member_count?: number
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon_key?: string | null
          id?: string
          member_count?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      driver_home_banners: {
        Row: {
          caption_ar: string | null
          caption_en: string | null
          created_at: string
          created_by: string | null
          deep_link: string | null
          driver_group_ids: string[]
          ends_at: string | null
          id: string
          image_object_key: string
          image_url: string
          is_active: boolean
          partner_ids: string[]
          sort_order: number
          starts_at: string | null
          updated_at: string
          zone_ids: string[]
        }
        Insert: {
          caption_ar?: string | null
          caption_en?: string | null
          created_at?: string
          created_by?: string | null
          deep_link?: string | null
          driver_group_ids?: string[]
          ends_at?: string | null
          id?: string
          image_object_key: string
          image_url: string
          is_active?: boolean
          partner_ids?: string[]
          sort_order?: number
          starts_at?: string | null
          updated_at?: string
          zone_ids?: string[]
        }
        Update: {
          caption_ar?: string | null
          caption_en?: string | null
          created_at?: string
          created_by?: string | null
          deep_link?: string | null
          driver_group_ids?: string[]
          ends_at?: string | null
          id?: string
          image_object_key?: string
          image_url?: string
          is_active?: boolean
          partner_ids?: string[]
          sort_order?: number
          starts_at?: string | null
          updated_at?: string
          zone_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "driver_home_banners_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_import_batches: {
        Row: {
          applied_count: number
          approve_immediately: boolean
          approved_count: number
          credentials: Json
          duplicate_strategy: string
          events: Json
          failed_count: number
          failures: Json
          file_name: string
          heartbeat_at: string | null
          id: string
          mapping: Json
          ready_count: number
          remaining_count: number
          remaining_rows: Json
          row_count: number
          skipped_count: number
          status: Database["public"]["Enums"]["driver_import_batch_status"]
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          applied_count?: number
          approve_immediately?: boolean
          approved_count?: number
          credentials?: Json
          duplicate_strategy?: string
          events?: Json
          failed_count?: number
          failures?: Json
          file_name: string
          heartbeat_at?: string | null
          id?: string
          mapping?: Json
          ready_count?: number
          remaining_count?: number
          remaining_rows?: Json
          row_count?: number
          skipped_count?: number
          status?: Database["public"]["Enums"]["driver_import_batch_status"]
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          applied_count?: number
          approve_immediately?: boolean
          approved_count?: number
          credentials?: Json
          duplicate_strategy?: string
          events?: Json
          failed_count?: number
          failures?: Json
          file_name?: string
          heartbeat_at?: string | null
          id?: string
          mapping?: Json
          ready_count?: number
          remaining_count?: number
          remaining_rows?: Json
          row_count?: number
          skipped_count?: number
          status?: Database["public"]["Enums"]["driver_import_batch_status"]
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_intake_restaurants: {
        Row: {
          created_at: string
          intake_id: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          intake_id: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          intake_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_intake_restaurants_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "driver_intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_intake_restaurants_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_intakes: {
        Row: {
          archived_at: string | null
          assets_issued: Json
          avatar_url: string | null
          civil_id: string | null
          client_id: string | null
          client_name: string | null
          created_at: string
          custom_fields: Json
          driver_code: string
          employee_id: string
          full_name: string
          id: string
          linked: boolean
          linked_profile_id: string | null
          nationality: string | null
          otp_code: string | null
          partner_id: string | null
          phone: string | null
          restaurant_id: string | null
          rider_category: Database["public"]["Enums"]["driver_rider_category"]
          status: Database["public"]["Enums"]["driver_intake_status"]
          updated_at: string
          vehicle_id: string | null
          vehicle_type_key: string | null
          workflow_status: Database["public"]["Enums"]["driver_workflow_status"]
          zone_id: string | null
        }
        Insert: {
          archived_at?: string | null
          assets_issued?: Json
          avatar_url?: string | null
          civil_id?: string | null
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          custom_fields?: Json
          driver_code: string
          employee_id: string
          full_name: string
          id?: string
          linked?: boolean
          linked_profile_id?: string | null
          nationality?: string | null
          otp_code?: string | null
          partner_id?: string | null
          phone?: string | null
          restaurant_id?: string | null
          rider_category?: Database["public"]["Enums"]["driver_rider_category"]
          status?: Database["public"]["Enums"]["driver_intake_status"]
          updated_at?: string
          vehicle_id?: string | null
          vehicle_type_key?: string | null
          workflow_status?: Database["public"]["Enums"]["driver_workflow_status"]
          zone_id?: string | null
        }
        Update: {
          archived_at?: string | null
          assets_issued?: Json
          avatar_url?: string | null
          civil_id?: string | null
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          custom_fields?: Json
          driver_code?: string
          employee_id?: string
          full_name?: string
          id?: string
          linked?: boolean
          linked_profile_id?: string | null
          nationality?: string | null
          otp_code?: string | null
          partner_id?: string | null
          phone?: string | null
          restaurant_id?: string | null
          rider_category?: Database["public"]["Enums"]["driver_rider_category"]
          status?: Database["public"]["Enums"]["driver_intake_status"]
          updated_at?: string
          vehicle_id?: string | null
          vehicle_type_key?: string | null
          workflow_status?: Database["public"]["Enums"]["driver_workflow_status"]
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_intakes_linked_profile_id_fkey"
            columns: ["linked_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_intakes_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_intakes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_intakes_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_intakes_vehicle_type_key_fkey"
            columns: ["vehicle_type_key"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "driver_intakes_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_location_events: {
        Row: {
          accuracy_meters: number | null
          active_delivery_id: string | null
          altitude_m: number | null
          battery_pct: number | null
          charging_state: string | null
          delivery_id: string | null
          driver_id: string
          heading_deg: number | null
          id: string
          is_mocked: boolean | null
          latitude: number
          location_provider: string | null
          longitude: number
          network_type: string | null
          recorded_at: string
          speed_mps: number | null
          tracking_status: string
          zone_status: string | null
        }
        Insert: {
          accuracy_meters?: number | null
          active_delivery_id?: string | null
          altitude_m?: number | null
          battery_pct?: number | null
          charging_state?: string | null
          delivery_id?: string | null
          driver_id: string
          heading_deg?: number | null
          id?: string
          is_mocked?: boolean | null
          latitude: number
          location_provider?: string | null
          longitude: number
          network_type?: string | null
          recorded_at?: string
          speed_mps?: number | null
          tracking_status: string
          zone_status?: string | null
        }
        Update: {
          accuracy_meters?: number | null
          active_delivery_id?: string | null
          altitude_m?: number | null
          battery_pct?: number | null
          charging_state?: string | null
          delivery_id?: string | null
          driver_id?: string
          heading_deg?: number | null
          id?: string
          is_mocked?: boolean | null
          latitude?: number
          location_provider?: string | null
          longitude?: number
          network_type?: string | null
          recorded_at?: string
          speed_mps?: number | null
          tracking_status?: string
          zone_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_location_events_active_delivery_id_fkey"
            columns: ["active_delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_location_events_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_location_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_locations: {
        Row: {
          accuracy_meters: number | null
          active_delivery_id: string | null
          altitude_m: number | null
          battery_pct: number | null
          charging_state: string | null
          coalesced_since_count: number
          distance_today_meters: number
          driver_id: string
          heading_deg: number | null
          is_mocked: boolean | null
          last_report_at: string | null
          last_seen_at: string
          latitude: number
          location_provider: string | null
          longitude: number
          network_type: string | null
          out_of_zone_since: string | null
          speed_mps: number | null
          tracking_status: string
          updated_at: string
          zone_status: string | null
        }
        Insert: {
          accuracy_meters?: number | null
          active_delivery_id?: string | null
          altitude_m?: number | null
          battery_pct?: number | null
          charging_state?: string | null
          coalesced_since_count?: number
          distance_today_meters?: number
          driver_id: string
          heading_deg?: number | null
          is_mocked?: boolean | null
          last_report_at?: string | null
          last_seen_at?: string
          latitude: number
          location_provider?: string | null
          longitude: number
          network_type?: string | null
          out_of_zone_since?: string | null
          speed_mps?: number | null
          tracking_status: string
          updated_at?: string
          zone_status?: string | null
        }
        Update: {
          accuracy_meters?: number | null
          active_delivery_id?: string | null
          altitude_m?: number | null
          battery_pct?: number | null
          charging_state?: string | null
          coalesced_since_count?: number
          distance_today_meters?: number
          driver_id?: string
          heading_deg?: number | null
          is_mocked?: boolean | null
          last_report_at?: string | null
          last_seen_at?: string
          latitude?: number
          location_provider?: string | null
          longitude?: number
          network_type?: string | null
          out_of_zone_since?: string | null
          speed_mps?: number | null
          tracking_status?: string
          updated_at?: string
          zone_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_locations_active_delivery_id_fkey"
            columns: ["active_delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_locations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_login_verifications: {
        Row: {
          captured_at: string
          created_at: string
          driver_id: string
          id: string
          liveness_method: string | null
          liveness_passed: boolean
          object_key: string
        }
        Insert: {
          captured_at?: string
          created_at?: string
          driver_id: string
          id?: string
          liveness_method?: string | null
          liveness_passed?: boolean
          object_key: string
        }
        Update: {
          captured_at?: string
          created_at?: string
          driver_id?: string
          id?: string
          liveness_method?: string | null
          liveness_passed?: boolean
          object_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_login_verifications_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_operation_events: {
        Row: {
          app_version_code: number | null
          category: string
          context: Json
          device_id: string | null
          driver_id: string
          entity_id: string | null
          entity_type: string | null
          error_code: string | null
          id: number
          latitude: number | null
          longitude: number | null
          occurred_at: string
          operation_key: string
          source: string
          source_name: string | null
          success: boolean
        }
        Insert: {
          app_version_code?: number | null
          category: string
          context?: Json
          device_id?: string | null
          driver_id: string
          entity_id?: string | null
          entity_type?: string | null
          error_code?: string | null
          id?: number
          latitude?: number | null
          longitude?: number | null
          occurred_at?: string
          operation_key: string
          source?: string
          source_name?: string | null
          success?: boolean
        }
        Update: {
          app_version_code?: number | null
          category?: string
          context?: Json
          device_id?: string | null
          driver_id?: string
          entity_id?: string | null
          entity_type?: string | null
          error_code?: string | null
          id?: number
          latitude?: number | null
          longitude?: number | null
          occurred_at?: string
          operation_key?: string
          source?: string
          source_name?: string | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "driver_operation_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_payouts: {
        Row: {
          adjustment_kwd: number
          base_kwd: number
          breakdown_snapshot: Json
          created_at: string
          delivery_count: number
          driver_id: string
          id: string
          incentive_kwd: number
          loan_deduction_kwd: number
          net_payable_kwd: number
          notes: string | null
          paid_at: string | null
          penalty_kwd: number
          period_end: string
          period_start: string
          reimbursement_kwd: number
          run_id: string
          status: Database["public"]["Enums"]["payout_run_status"]
          updated_at: string
        }
        Insert: {
          adjustment_kwd?: number
          base_kwd?: number
          breakdown_snapshot?: Json
          created_at?: string
          delivery_count?: number
          driver_id: string
          id?: string
          incentive_kwd?: number
          loan_deduction_kwd?: number
          net_payable_kwd?: number
          notes?: string | null
          paid_at?: string | null
          penalty_kwd?: number
          period_end: string
          period_start: string
          reimbursement_kwd?: number
          run_id: string
          status?: Database["public"]["Enums"]["payout_run_status"]
          updated_at?: string
        }
        Update: {
          adjustment_kwd?: number
          base_kwd?: number
          breakdown_snapshot?: Json
          created_at?: string
          delivery_count?: number
          driver_id?: string
          id?: string
          incentive_kwd?: number
          loan_deduction_kwd?: number
          net_payable_kwd?: number
          notes?: string | null
          paid_at?: string | null
          penalty_kwd?: number
          period_end?: string
          period_start?: string
          reimbursement_kwd?: number
          run_id?: string
          status?: Database["public"]["Enums"]["payout_run_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_payouts_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_payouts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payout_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_performance_daily: {
        Row: {
          absent: boolean
          computed_at: string
          conduct_weighted: number | null
          deliveries_completed: number | null
          deliveries_within_sla: number | null
          driver_id: string
          duty_seconds: number | null
          gps_offline_minutes: number | null
          log_date: string
          lost_minutes: number | null
          on_leave: boolean
          online_seconds: number | null
          out_of_zone_minutes: number | null
          overspeed_events: number | null
          scheduled_minutes: number | null
          sources_complete: string[]
          worked: boolean
        }
        Insert: {
          absent?: boolean
          computed_at?: string
          conduct_weighted?: number | null
          deliveries_completed?: number | null
          deliveries_within_sla?: number | null
          driver_id: string
          duty_seconds?: number | null
          gps_offline_minutes?: number | null
          log_date: string
          lost_minutes?: number | null
          on_leave?: boolean
          online_seconds?: number | null
          out_of_zone_minutes?: number | null
          overspeed_events?: number | null
          scheduled_minutes?: number | null
          sources_complete?: string[]
          worked?: boolean
        }
        Update: {
          absent?: boolean
          computed_at?: string
          conduct_weighted?: number | null
          deliveries_completed?: number | null
          deliveries_within_sla?: number | null
          driver_id?: string
          duty_seconds?: number | null
          gps_offline_minutes?: number | null
          log_date?: string
          lost_minutes?: number | null
          on_leave?: boolean
          online_seconds?: number | null
          out_of_zone_minutes?: number | null
          overspeed_events?: number | null
          scheduled_minutes?: number | null
          sources_complete?: string[]
          worked?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "driver_performance_daily_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_performance_rating_notes: {
        Row: {
          authored_by: string | null
          comment: string
          driver_id: string
          id: string
          period_month: string
          team_key: string
          updated_at: string
        }
        Insert: {
          authored_by?: string | null
          comment: string
          driver_id: string
          id?: string
          period_month: string
          team_key: string
          updated_at?: string
        }
        Update: {
          authored_by?: string | null
          comment?: string
          driver_id?: string
          id?: string
          period_month?: string
          team_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_performance_rating_notes_authored_by_fkey"
            columns: ["authored_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_performance_rating_notes_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_performance_rating_notes_team_key_fkey"
            columns: ["team_key"]
            isOneToOne: false
            referencedRelation: "performance_rating_teams"
            referencedColumns: ["key"]
          },
        ]
      }
      driver_performance_ratings: {
        Row: {
          criterion_id: string
          driver_id: string
          id: string
          period_month: string
          rated_at: string
          rated_by: string | null
          score: number
          updated_at: string
        }
        Insert: {
          criterion_id: string
          driver_id: string
          id?: string
          period_month: string
          rated_at?: string
          rated_by?: string | null
          score: number
          updated_at?: string
        }
        Update: {
          criterion_id?: string
          driver_id?: string
          id?: string
          period_month?: string
          rated_at?: string
          rated_by?: string | null
          score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_performance_ratings_criterion_id_fkey"
            columns: ["criterion_id"]
            isOneToOne: false
            referencedRelation: "performance_rating_criteria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_performance_ratings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_performance_ratings_rated_by_fkey"
            columns: ["rated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_push_tokens: {
        Row: {
          app_version: string | null
          created_at: string
          device_id: string | null
          driver_id: string
          id: string
          invalidated_at: string | null
          is_active: boolean
          last_seen_at: string
          platform: string
          provider: string
          token: string
          updated_at: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_id?: string | null
          driver_id: string
          id?: string
          invalidated_at?: string | null
          is_active?: boolean
          last_seen_at?: string
          platform?: string
          provider?: string
          token: string
          updated_at?: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_id?: string | null
          driver_id?: string
          id?: string
          invalidated_at?: string | null
          is_active?: boolean
          last_seen_at?: string
          platform?: string
          provider?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_push_tokens_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_restaurants: {
        Row: {
          created_at: string
          driver_id: string
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          restaurant_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_restaurants_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_restaurants_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_security_events: {
        Row: {
          context: Json
          created_at: string
          driver_id: string
          event_type: string
          id: string
          severity: string
        }
        Insert: {
          context?: Json
          created_at?: string
          driver_id: string
          event_type: string
          id?: string
          severity?: string
        }
        Update: {
          context?: Json
          created_at?: string
          driver_id?: string
          event_type?: string
          id?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_security_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_sessions: {
        Row: {
          created_at: string
          driver_id: string
          id: string
          is_online: boolean
          updated_at: string
          went_offline_at: string | null
          went_online_at: string | null
        }
        Insert: {
          created_at?: string
          driver_id: string
          id?: string
          is_online?: boolean
          updated_at?: string
          went_offline_at?: string | null
          went_online_at?: string | null
        }
        Update: {
          created_at?: string
          driver_id?: string
          id?: string
          is_online?: boolean
          updated_at?: string
          went_offline_at?: string | null
          went_online_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_sessions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_telemetry_event_types: {
        Row: {
          category: string
          context_keys: string[]
          created_at: string
          is_active: boolean
          label: string | null
          name: string
        }
        Insert: {
          category: string
          context_keys?: string[]
          created_at?: string
          is_active?: boolean
          label?: string | null
          name: string
        }
        Update: {
          category?: string
          context_keys?: string[]
          created_at?: string
          is_active?: boolean
          label?: string | null
          name?: string
        }
        Relationships: []
      }
      driver_telemetry_events: {
        Row: {
          app_version_code: number | null
          app_version_name: string | null
          category: string
          client_ts: string
          clock_skew_ms: number | null
          context: Json
          context_stripped_keys: number
          correlation_id: string | null
          device_id: string | null
          driver_id: string
          event_id: string
          event_name: string
          id: number
          network_state: string | null
          platform: string | null
          server_received_at: string
          session_id: string | null
          severity: string
        }
        Insert: {
          app_version_code?: number | null
          app_version_name?: string | null
          category: string
          client_ts: string
          clock_skew_ms?: number | null
          context?: Json
          context_stripped_keys?: number
          correlation_id?: string | null
          device_id?: string | null
          driver_id: string
          event_id: string
          event_name: string
          id?: number
          network_state?: string | null
          platform?: string | null
          server_received_at?: string
          session_id?: string | null
          severity?: string
        }
        Update: {
          app_version_code?: number | null
          app_version_name?: string | null
          category?: string
          client_ts?: string
          clock_skew_ms?: number | null
          context?: Json
          context_stripped_keys?: number
          correlation_id?: string | null
          device_id?: string | null
          driver_id?: string
          event_id?: string
          event_name?: string
          id?: number
          network_state?: string | null
          platform?: string | null
          server_received_at?: string
          session_id?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_telemetry_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_telemetry_events_event_name_fkey"
            columns: ["event_name"]
            isOneToOne: false
            referencedRelation: "driver_telemetry_event_types"
            referencedColumns: ["name"]
          },
        ]
      }
      driver_wallet_entries: {
        Row: {
          amount_kwd: number
          approved_at: string
          approved_by: string | null
          created_at: string
          driver_id: string
          earn_date: string
          entry_type: Database["public"]["Enums"]["wallet_entry_type"]
          id: string
          meta: Json
          source_ref: string
          status: Database["public"]["Enums"]["wallet_entry_status"]
          updated_at: string
        }
        Insert: {
          amount_kwd?: number
          approved_at?: string
          approved_by?: string | null
          created_at?: string
          driver_id: string
          earn_date: string
          entry_type?: Database["public"]["Enums"]["wallet_entry_type"]
          id?: string
          meta?: Json
          source_ref: string
          status?: Database["public"]["Enums"]["wallet_entry_status"]
          updated_at?: string
        }
        Update: {
          amount_kwd?: number
          approved_at?: string
          approved_by?: string | null
          created_at?: string
          driver_id?: string
          earn_date?: string
          entry_type?: Database["public"]["Enums"]["wallet_entry_type"]
          id?: string
          meta?: Json
          source_ref?: string
          status?: Database["public"]["Enums"]["wallet_entry_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_wallet_entries_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          active_device_id: string | null
          active_device_session_id: string | null
          app_passcode: string | null
          app_version_seen_at: string | null
          archived_at: string | null
          avatar_object_key: string | null
          avatar_updated_at: string | null
          base_earnings_kwd: number | null
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          civil_id: string | null
          client_id: string | null
          client_name: string | null
          created_at: string
          current_app_channel: string | null
          current_app_platform: string | null
          current_app_version_code: number | null
          current_app_version_name: string | null
          current_lat: number | null
          current_lng: number | null
          custom_fields: Json
          driver_code: string
          employee_id: string
          id: string
          is_blocked: boolean
          is_on_duty: boolean
          joined_at: string | null
          login_verification_exempt: boolean
          nationality: string | null
          partner_id: string | null
          restaurant_id: string | null
          rider_category: Database["public"]["Enums"]["driver_rider_category"]
          status: Database["public"]["Enums"]["driver_status"]
          updated_at: string
          vehicle_id: string | null
          vehicle_type_key: string | null
          zone_id: string | null
        }
        Insert: {
          active_device_id?: string | null
          active_device_session_id?: string | null
          app_passcode?: string | null
          app_version_seen_at?: string | null
          archived_at?: string | null
          avatar_object_key?: string | null
          avatar_updated_at?: string | null
          base_earnings_kwd?: number | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          civil_id?: string | null
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          current_app_channel?: string | null
          current_app_platform?: string | null
          current_app_version_code?: number | null
          current_app_version_name?: string | null
          current_lat?: number | null
          current_lng?: number | null
          custom_fields?: Json
          driver_code: string
          employee_id: string
          id: string
          is_blocked?: boolean
          is_on_duty?: boolean
          joined_at?: string | null
          login_verification_exempt?: boolean
          nationality?: string | null
          partner_id?: string | null
          restaurant_id?: string | null
          rider_category?: Database["public"]["Enums"]["driver_rider_category"]
          status?: Database["public"]["Enums"]["driver_status"]
          updated_at?: string
          vehicle_id?: string | null
          vehicle_type_key?: string | null
          zone_id?: string | null
        }
        Update: {
          active_device_id?: string | null
          active_device_session_id?: string | null
          app_passcode?: string | null
          app_version_seen_at?: string | null
          archived_at?: string | null
          avatar_object_key?: string | null
          avatar_updated_at?: string | null
          base_earnings_kwd?: number | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          civil_id?: string | null
          client_id?: string | null
          client_name?: string | null
          created_at?: string
          current_app_channel?: string | null
          current_app_platform?: string | null
          current_app_version_code?: number | null
          current_app_version_name?: string | null
          current_lat?: number | null
          current_lng?: number | null
          custom_fields?: Json
          driver_code?: string
          employee_id?: string
          id?: string
          is_blocked?: boolean
          is_on_duty?: boolean
          joined_at?: string | null
          login_verification_exempt?: boolean
          nationality?: string | null
          partner_id?: string | null
          restaurant_id?: string | null
          rider_category?: Database["public"]["Enums"]["driver_rider_category"]
          status?: Database["public"]["Enums"]["driver_status"]
          updated_at?: string
          vehicle_id?: string | null
          vehicle_type_key?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_vehicle_type_key_fkey"
            columns: ["vehicle_type_key"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "drivers_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      esign_categories: {
        Row: {
          created_at: string
          description: string | null
          icon_key: string | null
          id: string
          is_active: boolean
          key: string
          label_en: string
          screenshot_restricted: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon_key?: string | null
          id?: string
          is_active?: boolean
          key: string
          label_en: string
          screenshot_restricted?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          icon_key?: string | null
          id?: string
          is_active?: boolean
          key?: string
          label_en?: string
          screenshot_restricted?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      esign_requests: {
        Row: {
          category_key: string | null
          created_at: string
          declaration_accepted_at: string | null
          declined_at: string | null
          document_storage_key: string | null
          driver_id: string
          due_at: string | null
          id: string
          request_code: string
          screenshot_restricted: boolean
          sent_at: string
          sent_by: string | null
          signature_storage_key: string | null
          signed_at: string | null
          signed_document_error: string | null
          signed_document_generated_at: string | null
          signed_document_storage_key: string | null
          signer_display_name: string | null
          signer_meta: Json
          status: Database["public"]["Enums"]["esign_request_status"]
          title: string
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          category_key?: string | null
          created_at?: string
          declaration_accepted_at?: string | null
          declined_at?: string | null
          document_storage_key?: string | null
          driver_id: string
          due_at?: string | null
          id?: string
          request_code?: string
          screenshot_restricted?: boolean
          sent_at?: string
          sent_by?: string | null
          signature_storage_key?: string | null
          signed_at?: string | null
          signed_document_error?: string | null
          signed_document_generated_at?: string | null
          signed_document_storage_key?: string | null
          signer_display_name?: string | null
          signer_meta?: Json
          status?: Database["public"]["Enums"]["esign_request_status"]
          title: string
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          category_key?: string | null
          created_at?: string
          declaration_accepted_at?: string | null
          declined_at?: string | null
          document_storage_key?: string | null
          driver_id?: string
          due_at?: string | null
          id?: string
          request_code?: string
          screenshot_restricted?: boolean
          sent_at?: string
          sent_by?: string | null
          signature_storage_key?: string | null
          signed_at?: string | null
          signed_document_error?: string | null
          signed_document_generated_at?: string | null
          signed_document_storage_key?: string | null
          signer_display_name?: string | null
          signer_meta?: Json
          status?: Database["public"]["Enums"]["esign_request_status"]
          title?: string
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esign_requests_category_key_fkey"
            columns: ["category_key"]
            isOneToOne: false
            referencedRelation: "esign_categories"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "esign_requests_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esign_requests_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_events: {
        Row: {
          context: Json
          created_at: string
          detected_at: string
          driver_id: string
          event_key: string
          id: number
          latitude: number | null
          longitude: number | null
          severity: string
          source: string
          status_after: string | null
          status_before: string | null
          value: number | null
          zone_id: string | null
        }
        Insert: {
          context?: Json
          created_at?: string
          detected_at?: string
          driver_id: string
          event_key: string
          id?: number
          latitude?: number | null
          longitude?: number | null
          severity?: string
          source?: string
          status_after?: string | null
          status_before?: string | null
          value?: number | null
          zone_id?: string | null
        }
        Update: {
          context?: Json
          created_at?: string
          detected_at?: string
          driver_id?: string
          event_key?: string
          id?: number
          latitude?: number | null
          longitude?: number | null
          severity?: string
          source?: string
          status_after?: string | null
          status_before?: string | null
          value?: number | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fleet_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_events_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      geofence_events: {
        Row: {
          accuracy_meters: number | null
          driver_id: string | null
          event_type: string
          id: string
          latitude: number | null
          longitude: number | null
          metadata: Json
          occurred_at: string
          source: string
          zone_id: string | null
        }
        Insert: {
          accuracy_meters?: number | null
          driver_id?: string | null
          event_type: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          metadata?: Json
          occurred_at?: string
          source?: string
          zone_id?: string | null
        }
        Update: {
          accuracy_meters?: number | null
          driver_id?: string | null
          event_type?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          metadata?: Json
          occurred_at?: string
          source?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "geofence_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geofence_events_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      hygiene_submissions: {
        Row: {
          created_at: string
          driver_id: string
          id: string
          info: string | null
          penalty_kwd: number | null
          photo_url: string | null
          status: Database["public"]["Enums"]["hygiene_submission_status"]
          task_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          id?: string
          info?: string | null
          penalty_kwd?: number | null
          photo_url?: string | null
          status?: Database["public"]["Enums"]["hygiene_submission_status"]
          task_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          id?: string
          info?: string | null
          penalty_kwd?: number | null
          photo_url?: string | null
          status?: Database["public"]["Enums"]["hygiene_submission_status"]
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hygiene_submissions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hygiene_submissions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "hygiene_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      hygiene_tasks: {
        Row: {
          audience_filter: Json
          created_at: string
          id: string
          status: Database["public"]["Enums"]["hygiene_task_status"]
          title: string
          updated_at: string
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          audience_filter?: Json
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["hygiene_task_status"]
          title: string
          updated_at?: string
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          audience_filter?: Json
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["hygiene_task_status"]
          title?: string
          updated_at?: string
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      incentive_rule_scopes: {
        Row: {
          created_at: string
          id: string
          incentive_rule_id: string
          partner_id: string | null
          restaurant_id: string | null
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          incentive_rule_id: string
          partner_id?: string | null
          restaurant_id?: string | null
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          incentive_rule_id?: string
          partner_id?: string | null
          restaurant_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incentive_rule_scopes_incentive_rule_id_fkey"
            columns: ["incentive_rule_id"]
            isOneToOne: false
            referencedRelation: "incentive_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incentive_rule_scopes_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incentive_rule_scopes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incentive_rule_scopes_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      incentive_rule_tiers: {
        Row: {
          created_at: string
          id: string
          incentive_rule_id: string
          reward_kwd: number | null
          reward_mode: Database["public"]["Enums"]["incentive_reward_mode"]
          reward_per_delivery_kwd: number | null
          sort_order: number
          threshold_deliveries: number
        }
        Insert: {
          created_at?: string
          id?: string
          incentive_rule_id: string
          reward_kwd?: number | null
          reward_mode?: Database["public"]["Enums"]["incentive_reward_mode"]
          reward_per_delivery_kwd?: number | null
          sort_order?: number
          threshold_deliveries: number
        }
        Update: {
          created_at?: string
          id?: string
          incentive_rule_id?: string
          reward_kwd?: number | null
          reward_mode?: Database["public"]["Enums"]["incentive_reward_mode"]
          reward_per_delivery_kwd?: number | null
          sort_order?: number
          threshold_deliveries?: number
        }
        Relationships: [
          {
            foreignKeyName: "incentive_rule_tiers_incentive_rule_id_fkey"
            columns: ["incentive_rule_id"]
            isOneToOne: false
            referencedRelation: "incentive_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      incentive_rules: {
        Row: {
          base_minimum_deliveries: number
          created_at: string
          end_date: string
          id: string
          name: string
          overrides_others: boolean
          partner_id: string | null
          payout_mode: Database["public"]["Enums"]["incentive_payout_mode"]
          period: Database["public"]["Enums"]["incentive_period"]
          priority: number
          restaurant_id: string | null
          reward_kwd: number
          reward_mode: Database["public"]["Enums"]["incentive_reward_mode"]
          reward_per_delivery_kwd: number | null
          scope_type: Database["public"]["Enums"]["rule_scope_type"]
          start_date: string
          status: Database["public"]["Enums"]["rule_status"]
          target_deliveries: number | null
          target_mode: Database["public"]["Enums"]["incentive_target_mode"]
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          base_minimum_deliveries?: number
          created_at?: string
          end_date: string
          id?: string
          name: string
          overrides_others?: boolean
          partner_id?: string | null
          payout_mode?: Database["public"]["Enums"]["incentive_payout_mode"]
          period: Database["public"]["Enums"]["incentive_period"]
          priority?: number
          restaurant_id?: string | null
          reward_kwd?: number
          reward_mode?: Database["public"]["Enums"]["incentive_reward_mode"]
          reward_per_delivery_kwd?: number | null
          scope_type: Database["public"]["Enums"]["rule_scope_type"]
          start_date: string
          status?: Database["public"]["Enums"]["rule_status"]
          target_deliveries?: number | null
          target_mode?: Database["public"]["Enums"]["incentive_target_mode"]
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          base_minimum_deliveries?: number
          created_at?: string
          end_date?: string
          id?: string
          name?: string
          overrides_others?: boolean
          partner_id?: string | null
          payout_mode?: Database["public"]["Enums"]["incentive_payout_mode"]
          period?: Database["public"]["Enums"]["incentive_period"]
          priority?: number
          restaurant_id?: string | null
          reward_kwd?: number
          reward_mode?: Database["public"]["Enums"]["incentive_reward_mode"]
          reward_per_delivery_kwd?: number | null
          scope_type?: Database["public"]["Enums"]["rule_scope_type"]
          start_date?: string
          status?: Database["public"]["Enums"]["rule_status"]
          target_deliveries?: number | null
          target_mode?: Database["public"]["Enums"]["incentive_target_mode"]
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incentive_rules_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incentive_rules_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incentive_rules_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_tenure_options: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label: string
          months: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          months: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          months?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      loan_terms: {
        Row: {
          created_at: string
          deduction_kwd: number
          id: string
          installment_remaining: number
          months: number
          request_id: string
          total_kwd: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deduction_kwd: number
          id?: string
          installment_remaining: number
          months: number
          request_id: string
          total_kwd: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deduction_kwd?: number
          id?: string
          installment_remaining?: number
          months?: number
          request_id?: string
          total_kwd?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_terms_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      locales: {
        Row: {
          code: string
          created_at: string
          dir: string
          enabled: boolean
          is_default: boolean
          name: string
          native_name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          dir?: string
          enabled?: boolean
          is_default?: boolean
          name: string
          native_name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          dir?: string
          enabled?: boolean
          is_default?: boolean
          name?: string
          native_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      menu_configs: {
        Row: {
          config: Json
          id: string
          role: string
          scope: string
          site_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config?: Json
          id?: string
          role: string
          scope?: string
          site_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config?: Json
          id?: string
          role?: string
          scope?: string
          site_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      notification_analytics_daily: {
        Row: {
          campaign_id: string
          clicked_count: number
          created_at: string
          delivered_count: number
          failed_count: number
          metric_date: string
          opened_count: number
          sent_count: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          clicked_count?: number
          created_at?: string
          delivered_count?: number
          failed_count?: number
          metric_date: string
          opened_count?: number
          sent_count?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          clicked_count?: number
          created_at?: string
          delivered_count?: number
          failed_count?: number
          metric_date?: string
          opened_count?: number
          sent_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_analytics_daily_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "notification_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_audience_snapshots: {
        Row: {
          campaign_id: string
          compiled_at: string
          created_at: string
          exclusion_spec: Json
          id: string
          recipient_count: number
          recipient_ids: string[]
          target_spec: Json
        }
        Insert: {
          campaign_id: string
          compiled_at?: string
          created_at?: string
          exclusion_spec?: Json
          id?: string
          recipient_count?: number
          recipient_ids?: string[]
          target_spec?: Json
        }
        Update: {
          campaign_id?: string
          compiled_at?: string
          created_at?: string
          exclusion_spec?: Json
          id?: string
          recipient_count?: number
          recipient_ids?: string[]
          target_spec?: Json
        }
        Relationships: [
          {
            foreignKeyName: "notification_audience_snapshots_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "notification_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_automation_events: {
        Row: {
          created_at: string
          driver_id: string | null
          id: string
          payload: Json
          processed_at: string | null
          trigger_type: Database["public"]["Enums"]["notification_automation_trigger"]
        }
        Insert: {
          created_at?: string
          driver_id?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          trigger_type: Database["public"]["Enums"]["notification_automation_trigger"]
        }
        Update: {
          created_at?: string
          driver_id?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          trigger_type?: Database["public"]["Enums"]["notification_automation_trigger"]
        }
        Relationships: [
          {
            foreignKeyName: "notification_automation_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_automation_runs: {
        Row: {
          automation_id: string
          campaign_id: string | null
          created_at: string
          error_summary: string | null
          failed_count: number
          finished_at: string | null
          id: string
          matched_count: number
          sent_count: number
          started_at: string
          status: string
        }
        Insert: {
          automation_id: string
          campaign_id?: string | null
          created_at?: string
          error_summary?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          matched_count?: number
          sent_count?: number
          started_at?: string
          status?: string
        }
        Update: {
          automation_id?: string
          campaign_id?: string | null
          created_at?: string
          error_summary?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          matched_count?: number
          sent_count?: number
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_automation_runs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "notification_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_automation_runs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "notification_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_automations: {
        Row: {
          action_params: Json
          action_type: Database["public"]["Enums"]["notification_action_type"]
          body_template: string | null
          category: Database["public"]["Enums"]["notification_category"]
          condition_spec: Json
          consecutive_failures: number
          cooldown_minutes: number
          created_at: string
          created_by: string | null
          description: string | null
          exclusion_spec: Json
          failure_threshold: number
          id: string
          last_run_at: string | null
          max_retries: number
          name: string
          next_run_at: string | null
          priority: Database["public"]["Enums"]["notification_priority"]
          status: Database["public"]["Enums"]["notification_automation_status"]
          target_spec: Json
          template_id: string | null
          throttle_minutes: number
          title_template: string | null
          trigger_config: Json
          trigger_type: Database["public"]["Enums"]["notification_automation_trigger"]
          updated_at: string
        }
        Insert: {
          action_params?: Json
          action_type?: Database["public"]["Enums"]["notification_action_type"]
          body_template?: string | null
          category?: Database["public"]["Enums"]["notification_category"]
          condition_spec?: Json
          consecutive_failures?: number
          cooldown_minutes?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          exclusion_spec?: Json
          failure_threshold?: number
          id?: string
          last_run_at?: string | null
          max_retries?: number
          name: string
          next_run_at?: string | null
          priority?: Database["public"]["Enums"]["notification_priority"]
          status?: Database["public"]["Enums"]["notification_automation_status"]
          target_spec?: Json
          template_id?: string | null
          throttle_minutes?: number
          title_template?: string | null
          trigger_config?: Json
          trigger_type: Database["public"]["Enums"]["notification_automation_trigger"]
          updated_at?: string
        }
        Update: {
          action_params?: Json
          action_type?: Database["public"]["Enums"]["notification_action_type"]
          body_template?: string | null
          category?: Database["public"]["Enums"]["notification_category"]
          condition_spec?: Json
          consecutive_failures?: number
          cooldown_minutes?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          exclusion_spec?: Json
          failure_threshold?: number
          id?: string
          last_run_at?: string | null
          max_retries?: number
          name?: string
          next_run_at?: string | null
          priority?: Database["public"]["Enums"]["notification_priority"]
          status?: Database["public"]["Enums"]["notification_automation_status"]
          target_spec?: Json
          template_id?: string | null
          throttle_minutes?: number
          title_template?: string | null
          trigger_config?: Json
          trigger_type?: Database["public"]["Enums"]["notification_automation_trigger"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_automations_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "notification_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_campaigns: {
        Row: {
          action_params: Json
          action_type: Database["public"]["Enums"]["notification_action_type"]
          approved_at: string | null
          approved_by: string | null
          body: string
          cancelled_at: string | null
          category: Database["public"]["Enums"]["notification_category"]
          clicked_count: number
          cloned_from_id: string | null
          created_at: string
          created_by: string | null
          delivered_count: number
          estimated_audience_count: number
          exclusion_spec: Json
          expires_at: string | null
          failed_count: number
          id: string
          import_spec: Json
          media: Json
          opened_count: number
          payload_version: number
          priority: Database["public"]["Enums"]["notification_priority"]
          quiet_hours: Json
          recipient_count: number
          requires_approval: boolean
          schedule_spec: Json
          scheduled_for: string | null
          screenshot_restricted: boolean
          screenshot_restricted_override: boolean | null
          send_limit: number | null
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_campaign_status"]
          submitted_for_approval_at: string | null
          target_spec: Json
          template_id: string | null
          timezone: string
          title: string
          track_engagement: boolean
          updated_at: string
          updated_by: string | null
          variables: Json
        }
        Insert: {
          action_params?: Json
          action_type?: Database["public"]["Enums"]["notification_action_type"]
          approved_at?: string | null
          approved_by?: string | null
          body: string
          cancelled_at?: string | null
          category?: Database["public"]["Enums"]["notification_category"]
          clicked_count?: number
          cloned_from_id?: string | null
          created_at?: string
          created_by?: string | null
          delivered_count?: number
          estimated_audience_count?: number
          exclusion_spec?: Json
          expires_at?: string | null
          failed_count?: number
          id?: string
          import_spec?: Json
          media?: Json
          opened_count?: number
          payload_version?: number
          priority?: Database["public"]["Enums"]["notification_priority"]
          quiet_hours?: Json
          recipient_count?: number
          requires_approval?: boolean
          schedule_spec?: Json
          scheduled_for?: string | null
          screenshot_restricted?: boolean
          screenshot_restricted_override?: boolean | null
          send_limit?: number | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_campaign_status"]
          submitted_for_approval_at?: string | null
          target_spec?: Json
          template_id?: string | null
          timezone?: string
          title: string
          track_engagement?: boolean
          updated_at?: string
          updated_by?: string | null
          variables?: Json
        }
        Update: {
          action_params?: Json
          action_type?: Database["public"]["Enums"]["notification_action_type"]
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          cancelled_at?: string | null
          category?: Database["public"]["Enums"]["notification_category"]
          clicked_count?: number
          cloned_from_id?: string | null
          created_at?: string
          created_by?: string | null
          delivered_count?: number
          estimated_audience_count?: number
          exclusion_spec?: Json
          expires_at?: string | null
          failed_count?: number
          id?: string
          import_spec?: Json
          media?: Json
          opened_count?: number
          payload_version?: number
          priority?: Database["public"]["Enums"]["notification_priority"]
          quiet_hours?: Json
          recipient_count?: number
          requires_approval?: boolean
          schedule_spec?: Json
          scheduled_for?: string | null
          screenshot_restricted?: boolean
          screenshot_restricted_override?: boolean | null
          send_limit?: number | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_campaign_status"]
          submitted_for_approval_at?: string | null
          target_spec?: Json
          template_id?: string | null
          timezone?: string
          title?: string
          track_engagement?: boolean
          updated_at?: string
          updated_by?: string | null
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "notification_campaigns_cloned_from_id_fkey"
            columns: ["cloned_from_id"]
            isOneToOne: false
            referencedRelation: "notification_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "notification_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_dedup_keys: {
        Row: {
          automation_id: string | null
          campaign_id: string | null
          created_at: string
          dedup_key: string
          driver_id: string | null
          expires_at: string
          id: string
        }
        Insert: {
          automation_id?: string | null
          campaign_id?: string | null
          created_at?: string
          dedup_key: string
          driver_id?: string | null
          expires_at: string
          id?: string
        }
        Update: {
          automation_id?: string | null
          campaign_id?: string | null
          created_at?: string
          dedup_key?: string
          driver_id?: string | null
          expires_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_dedup_keys_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "notification_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_dedup_keys_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "notification_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_dedup_keys_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_dispatch_items: {
        Row: {
          campaign_id: string
          clicked_at: string | null
          created_at: string
          delivered_at: string | null
          dismissed_at: string | null
          driver_id: string
          error_code: string | null
          error_message: string | null
          id: string
          import_row_index: number | null
          import_vars: Json | null
          opened_at: string | null
          provider_message_id: string | null
          push_token_id: string | null
          resolved_body: string | null
          resolved_title: string | null
          retry_count: number
          run_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_dispatch_item_status"]
          updated_at: string
        }
        Insert: {
          campaign_id: string
          clicked_at?: string | null
          created_at?: string
          delivered_at?: string | null
          dismissed_at?: string | null
          driver_id: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          import_row_index?: number | null
          import_vars?: Json | null
          opened_at?: string | null
          provider_message_id?: string | null
          push_token_id?: string | null
          resolved_body?: string | null
          resolved_title?: string | null
          retry_count?: number
          run_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_dispatch_item_status"]
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          clicked_at?: string | null
          created_at?: string
          delivered_at?: string | null
          dismissed_at?: string | null
          driver_id?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          import_row_index?: number | null
          import_vars?: Json | null
          opened_at?: string | null
          provider_message_id?: string | null
          push_token_id?: string | null
          resolved_body?: string | null
          resolved_title?: string | null
          retry_count?: number
          run_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_dispatch_item_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_dispatch_items_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "notification_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_dispatch_items_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_dispatch_items_push_token_id_fkey"
            columns: ["push_token_id"]
            isOneToOne: false
            referencedRelation: "driver_push_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_dispatch_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "notification_dispatch_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_dispatch_runs: {
        Row: {
          campaign_id: string
          created_at: string
          error_summary: string | null
          failed_count: number
          finished_at: string | null
          id: string
          idempotency_key: string
          provider: string
          scheduled_for: string | null
          sent_count: number
          snapshot_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["notification_campaign_status"]
          total_count: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          error_summary?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          idempotency_key: string
          provider?: string
          scheduled_for?: string | null
          sent_count?: number
          snapshot_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["notification_campaign_status"]
          total_count?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          error_summary?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          provider?: string
          scheduled_for?: string | null
          sent_count?: number
          snapshot_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["notification_campaign_status"]
          total_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_dispatch_runs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "notification_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_dispatch_runs_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "notification_audience_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          campaign_id: string | null
          created_at: string
          dispatch_item_id: string | null
          driver_id: string | null
          event_type: Database["public"]["Enums"]["notification_event_type"]
          id: string
          metadata: Json
          occurred_at: string
          provider: string
          provider_event_id: string | null
          run_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          dispatch_item_id?: string | null
          driver_id?: string | null
          event_type: Database["public"]["Enums"]["notification_event_type"]
          id?: string
          metadata?: Json
          occurred_at?: string
          provider?: string
          provider_event_id?: string | null
          run_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          dispatch_item_id?: string | null
          driver_id?: string | null
          event_type?: Database["public"]["Enums"]["notification_event_type"]
          id?: string
          metadata?: Json
          occurred_at?: string
          provider?: string
          provider_event_id?: string | null
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "notification_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_dispatch_item_id_fkey"
            columns: ["dispatch_item_id"]
            isOneToOne: false
            referencedRelation: "notification_dispatch_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "notification_dispatch_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_remote_config: {
        Row: {
          category_throttles: Json
          emergency_gate_enabled: boolean
          global_enabled: boolean
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category_throttles?: Json
          emergency_gate_enabled?: boolean
          global_enabled?: boolean
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category_throttles?: Json
          emergency_gate_enabled?: boolean
          global_enabled?: boolean
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      notification_templates: {
        Row: {
          action_params: Json
          action_type: Database["public"]["Enums"]["notification_action_type"]
          body_template: string
          category: Database["public"]["Enums"]["notification_category"]
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          name: string
          payload_version: number
          priority: Database["public"]["Enums"]["notification_priority"]
          screenshot_restricted: boolean
          title_template: string
          updated_at: string
          variable_schema: Json
        }
        Insert: {
          action_params?: Json
          action_type?: Database["public"]["Enums"]["notification_action_type"]
          body_template: string
          category?: Database["public"]["Enums"]["notification_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          name: string
          payload_version?: number
          priority?: Database["public"]["Enums"]["notification_priority"]
          screenshot_restricted?: boolean
          title_template: string
          updated_at?: string
          variable_schema?: Json
        }
        Update: {
          action_params?: Json
          action_type?: Database["public"]["Enums"]["notification_action_type"]
          body_template?: string
          category?: Database["public"]["Enums"]["notification_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          payload_version?: number
          priority?: Database["public"]["Enums"]["notification_priority"]
          screenshot_restricted?: boolean
          title_template?: string
          updated_at?: string
          variable_schema?: Json
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      offers: {
        Row: {
          created_at: string
          end_date: string
          id: string
          name: string
          offer_type: Database["public"]["Enums"]["offer_type"]
          reward_kwd: number
          start_date: string
          status: Database["public"]["Enums"]["offer_status"]
          target_deliveries: number
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          name: string
          offer_type: Database["public"]["Enums"]["offer_type"]
          reward_kwd?: number
          start_date: string
          status?: Database["public"]["Enums"]["offer_status"]
          target_deliveries?: number
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          name?: string
          offer_type?: Database["public"]["Enums"]["offer_type"]
          reward_kwd?: number
          start_date?: string
          status?: Database["public"]["Enums"]["offer_status"]
          target_deliveries?: number
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offers_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          address: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone_1: string | null
          contact_phone_2: string | null
          contact_role: string | null
          created_at: string
          description: string | null
          id: string
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone_1?: string | null
          contact_phone_2?: string | null
          contact_role?: string | null
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone_1?: string | null
          contact_phone_2?: string | null
          contact_role?: string | null
          created_at?: string
          description?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      payout_runs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          period_end: string
          period_start: string
          status: Database["public"]["Enums"]["payout_run_status"]
          total_drivers: number
          total_payable_kwd: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          period_end: string
          period_start: string
          status?: Database["public"]["Enums"]["payout_run_status"]
          total_drivers?: number
          total_payable_kwd?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          period_end?: string
          period_start?: string
          status?: Database["public"]["Enums"]["payout_run_status"]
          total_drivers?: number
          total_payable_kwd?: number
          updated_at?: string
        }
        Relationships: []
      }
      performance_rating_criteria: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order: number
          team_key: string
          weight: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order?: number
          team_key: string
          weight?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          label_ar?: string
          label_en?: string
          sort_order?: number
          team_key?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "performance_rating_criteria_team_key_fkey"
            columns: ["team_key"]
            isOneToOne: false
            referencedRelation: "performance_rating_teams"
            referencedColumns: ["key"]
          },
        ]
      }
      performance_rating_team_members: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          profile_id: string
          team_key: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          profile_id: string
          team_key: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          profile_id?: string
          team_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_rating_team_members_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_rating_team_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_rating_team_members_team_key_fkey"
            columns: ["team_key"]
            isOneToOne: false
            referencedRelation: "performance_rating_teams"
            referencedColumns: ["key"]
          },
        ]
      }
      performance_rating_teams: {
        Row: {
          created_at: string
          is_active: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order: number
          weight: number
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order?: number
          weight?: number
        }
        Update: {
          created_at?: string
          is_active?: boolean
          key?: string
          label_ar?: string
          label_en?: string
          sort_order?: number
          weight?: number
        }
        Relationships: []
      }
      performance_score_components: {
        Row: {
          created_at: string
          is_active: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order: number
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order?: number
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          is_active?: boolean
          key?: string
          label_ar?: string
          label_en?: string
          sort_order?: number
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          admin_role_id: string | null
          approval_status: Database["public"]["Enums"]["admin_approval_status"]
          approved_at: string | null
          approved_by: string | null
          archived_at: string | null
          avatar_url: string | null
          company_id: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          locale: string
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          admin_role_id?: string | null
          approval_status?: Database["public"]["Enums"]["admin_approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          locale?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          admin_role_id?: string | null
          approval_status?: Database["public"]["Enums"]["admin_approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          archived_at?: string | null
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          locale?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_admin_role_id_fkey"
            columns: ["admin_role_id"]
            isOneToOne: false
            referencedRelation: "admin_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      request_approval_step_templates: {
        Row: {
          allowed_actions: string[]
          breach_action: string | null
          created_at: string
          id: string
          is_system_auto: boolean
          request_type: string
          role_key: string
          sla_minutes: number | null
          step_name: string
          step_order: number
          updated_at: string
        }
        Insert: {
          allowed_actions?: string[]
          breach_action?: string | null
          created_at?: string
          id?: string
          is_system_auto?: boolean
          request_type: string
          role_key: string
          sla_minutes?: number | null
          step_name: string
          step_order: number
          updated_at?: string
        }
        Update: {
          allowed_actions?: string[]
          breach_action?: string | null
          created_at?: string
          id?: string
          is_system_auto?: boolean
          request_type?: string
          role_key?: string
          sla_minutes?: number | null
          step_name?: string
          step_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_approval_step_templates_request_type_fkey"
            columns: ["request_type"]
            isOneToOne: false
            referencedRelation: "request_type_definitions"
            referencedColumns: ["key"]
          },
        ]
      }
      request_approval_steps: {
        Row: {
          actor_display_name: string | null
          breach_action: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          meta: Json
          request_id: string
          role_key: string
          sla_breached_at: string | null
          sla_due_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["request_step_status"]
          step_name: string
          step_order: number
          updated_at: string
        }
        Insert: {
          actor_display_name?: string | null
          breach_action?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          meta?: Json
          request_id: string
          role_key: string
          sla_breached_at?: string | null
          sla_due_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["request_step_status"]
          step_name: string
          step_order: number
          updated_at?: string
        }
        Update: {
          actor_display_name?: string | null
          breach_action?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          meta?: Json
          request_id?: string
          role_key?: string
          sla_breached_at?: string | null
          sla_due_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["request_step_status"]
          step_name?: string
          step_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_approval_steps_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_approval_steps_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_attachments: {
        Row: {
          byte_size: number | null
          content_type: string | null
          created_at: string
          file_name: string | null
          id: string
          request_id: string
          storage_key: string
          uploaded_by: string | null
        }
        Insert: {
          byte_size?: number | null
          content_type?: string | null
          created_at?: string
          file_name?: string | null
          id?: string
          request_id: string
          storage_key: string
          uploaded_by?: string | null
        }
        Update: {
          byte_size?: number | null
          content_type?: string | null
          created_at?: string
          file_name?: string | null
          id?: string
          request_id?: string
          storage_key?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "request_attachments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      request_clarifications: {
        Row: {
          answer: string | null
          answer_attachment_keys: string[]
          answered_at: string | null
          asked_at: string
          asked_by: string | null
          created_at: string
          id: string
          question: string
          request_id: string
          step_order: number | null
        }
        Insert: {
          answer?: string | null
          answer_attachment_keys?: string[]
          answered_at?: string | null
          asked_at?: string
          asked_by?: string | null
          created_at?: string
          id?: string
          question: string
          request_id: string
          step_order?: number | null
        }
        Update: {
          answer?: string | null
          answer_attachment_keys?: string[]
          answered_at?: string | null
          asked_at?: string
          asked_by?: string | null
          created_at?: string
          id?: string
          question?: string
          request_id?: string
          step_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "request_clarifications_asked_by_fkey"
            columns: ["asked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_clarifications_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_department_members: {
        Row: {
          created_at: string
          department_id: string
          id: string
          is_active: boolean
          profile_id: string
          role_title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          is_active?: boolean
          profile_id: string
          role_title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          is_active?: boolean
          profile_id?: string
          role_title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_department_members_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "request_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_department_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      request_departments: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key: string
          label_ar: string | null
          label_en: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key: string
          label_ar?: string | null
          label_en: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key?: string
          label_ar?: string | null
          label_en?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      request_field_definitions: {
        Row: {
          created_at: string
          field_key: string
          help_ar: string | null
          help_en: string | null
          id: string
          is_required: boolean
          is_server_required: boolean
          kind: string
          label_ar: string | null
          label_en: string
          max_value: number | null
          min_value: number | null
          options: Json
          options_error_code: string | null
          options_source: string | null
          required_error_code: string | null
          sort_order: number
          target: string
          type_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          field_key: string
          help_ar?: string | null
          help_en?: string | null
          id?: string
          is_required?: boolean
          is_server_required?: boolean
          kind: string
          label_ar?: string | null
          label_en: string
          max_value?: number | null
          min_value?: number | null
          options?: Json
          options_error_code?: string | null
          options_source?: string | null
          required_error_code?: string | null
          sort_order?: number
          target?: string
          type_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          field_key?: string
          help_ar?: string | null
          help_en?: string | null
          id?: string
          is_required?: boolean
          is_server_required?: boolean
          kind?: string
          label_ar?: string | null
          label_en?: string
          max_value?: number | null
          min_value?: number | null
          options?: Json
          options_error_code?: string | null
          options_source?: string | null
          required_error_code?: string | null
          sort_order?: number
          target?: string
          type_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_field_definitions_type_key_fkey"
            columns: ["type_key"]
            isOneToOne: false
            referencedRelation: "request_type_definitions"
            referencedColumns: ["key"]
          },
        ]
      }
      request_staff_access: {
        Row: {
          access_level: Database["public"]["Enums"]["request_access_level"]
          created_at: string
          id: string
          profile_id: string
          request_type: string
          updated_at: string
        }
        Insert: {
          access_level: Database["public"]["Enums"]["request_access_level"]
          created_at?: string
          id?: string
          profile_id: string
          request_type: string
          updated_at?: string
        }
        Update: {
          access_level?: Database["public"]["Enums"]["request_access_level"]
          created_at?: string
          id?: string
          profile_id?: string
          request_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_staff_access_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_staff_access_request_type_fkey"
            columns: ["request_type"]
            isOneToOne: false
            referencedRelation: "request_type_definitions"
            referencedColumns: ["key"]
          },
        ]
      }
      request_type_definitions: {
        Row: {
          attachments_error_code: string | null
          created_at: string
          date_range_required: boolean
          icon_key: string | null
          id: string
          is_active: boolean
          is_system: boolean
          key: string
          label_ar: string | null
          label_en: string
          min_attachments: number
          requires_driver_ack_on_approve: boolean
          screenshot_restricted: boolean
          sort_order: number
          terminal_status_on_approve: string
          updated_at: string
        }
        Insert: {
          attachments_error_code?: string | null
          created_at?: string
          date_range_required?: boolean
          icon_key?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          key: string
          label_ar?: string | null
          label_en: string
          min_attachments?: number
          requires_driver_ack_on_approve?: boolean
          screenshot_restricted?: boolean
          sort_order?: number
          terminal_status_on_approve?: string
          updated_at?: string
        }
        Update: {
          attachments_error_code?: string | null
          created_at?: string
          date_range_required?: boolean
          icon_key?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          key?: string
          label_ar?: string | null
          label_en?: string
          min_attachments?: number
          requires_driver_ack_on_approve?: boolean
          screenshot_restricted?: boolean
          sort_order?: number
          terminal_status_on_approve?: string
          updated_at?: string
        }
        Relationships: []
      }
      requests: {
        Row: {
          acknowledged_at: string | null
          amount_kwd: number | null
          assigned_to: string | null
          attachment_url: string | null
          attention_at: string | null
          attention_cleared_at: string | null
          attention_reason: string | null
          closed_at: string | null
          closed_by: string | null
          completed_at: string | null
          created_at: string
          current_step_label: string | null
          current_step_order: number | null
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          details: string | null
          driver_id: string
          due_at: string | null
          end_date: string | null
          fuel_transfer_type: string | null
          id: string
          needs_attention: boolean
          payload: Json
          request_code: string
          request_type: string
          severity: Database["public"]["Enums"]["severity_level"] | null
          sla_breach_action: string | null
          sla_due_at: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["request_status"]
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          amount_kwd?: number | null
          assigned_to?: string | null
          attachment_url?: string | null
          attention_at?: string | null
          attention_cleared_at?: string | null
          attention_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          completed_at?: string | null
          created_at?: string
          current_step_label?: string | null
          current_step_order?: number | null
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          details?: string | null
          driver_id: string
          due_at?: string | null
          end_date?: string | null
          fuel_transfer_type?: string | null
          id?: string
          needs_attention?: boolean
          payload?: Json
          request_code: string
          request_type: string
          severity?: Database["public"]["Enums"]["severity_level"] | null
          sla_breach_action?: string | null
          sla_due_at?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          amount_kwd?: number | null
          assigned_to?: string | null
          attachment_url?: string | null
          attention_at?: string | null
          attention_cleared_at?: string | null
          attention_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          completed_at?: string | null
          created_at?: string
          current_step_label?: string | null
          current_step_order?: number | null
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          details?: string | null
          driver_id?: string
          due_at?: string | null
          end_date?: string | null
          fuel_transfer_type?: string | null
          id?: string
          needs_attention?: boolean
          payload?: Json
          request_code?: string
          request_type?: string
          severity?: Database["public"]["Enums"]["severity_level"] | null
          sla_breach_action?: string | null
          sla_due_at?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "requests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_request_type_fkey"
            columns: ["request_type"]
            isOneToOne: false
            referencedRelation: "request_type_definitions"
            referencedColumns: ["key"]
          },
        ]
      }
      restaurant_geofences: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          geometry: Json
          id: string
          kind: Database["public"]["Enums"]["restaurant_geofence_kind"]
          name: string | null
          restaurant_id: string
          updated_at: string
          zone_type: Database["public"]["Enums"]["zone_geometry_type"]
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          geometry: Json
          id?: string
          kind: Database["public"]["Enums"]["restaurant_geofence_kind"]
          name?: string | null
          restaurant_id: string
          updated_at?: string
          zone_type: Database["public"]["Enums"]["zone_geometry_type"]
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          geometry?: Json
          id?: string
          kind?: Database["public"]["Enums"]["restaurant_geofence_kind"]
          name?: string | null
          restaurant_id?: string
          updated_at?: string
          zone_type?: Database["public"]["Enums"]["zone_geometry_type"]
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_geofences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_geofences_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          created_at: string
          created_by: string | null
          external_merchant_id: string | null
          id: string
          is_active: boolean
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          map_link: string | null
          name: string
          partner_id: string | null
          restaurant_code: string
          status: Database["public"]["Enums"]["restaurant_status"]
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          external_merchant_id?: string | null
          id?: string
          is_active?: boolean
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          map_link?: string | null
          name: string
          partner_id?: string | null
          restaurant_code?: string
          status?: Database["public"]["Enums"]["restaurant_status"]
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          external_merchant_id?: string | null
          id?: string
          is_active?: boolean
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          map_link?: string | null
          name?: string
          partner_id?: string | null
          restaurant_code?: string
          status?: Database["public"]["Enums"]["restaurant_status"]
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurants_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurants_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurants_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_uploads: {
        Row: {
          bucket: string
          confirmed_at: string | null
          content_type: string | null
          entity_id: string | null
          entity_type: string | null
          expires_at: string | null
          id: string
          object_key: string
          size_bytes: number | null
          status: string
          uploaded_at: string
          uploaded_by: string | null
          uploaded_via: string
        }
        Insert: {
          bucket: string
          confirmed_at?: string | null
          content_type?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string
          object_key: string
          size_bytes?: number | null
          status?: string
          uploaded_at?: string
          uploaded_by?: string | null
          uploaded_via?: string
        }
        Update: {
          bucket?: string
          confirmed_at?: string | null
          content_type?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string
          object_key?: string
          size_bytes?: number | null
          status?: string
          uploaded_at?: string
          uploaded_by?: string | null
          uploaded_via?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          attachment_url: string | null
          body: string
          created_at: string
          id: string
          sender: Database["public"]["Enums"]["message_sender"]
          sent_at: string
          thread_id: string
        }
        Insert: {
          attachment_url?: string | null
          body: string
          created_at?: string
          id?: string
          sender: Database["public"]["Enums"]["message_sender"]
          sent_at?: string
          thread_id: string
        }
        Update: {
          attachment_url?: string | null
          body?: string
          created_at?: string
          id?: string
          sender?: Database["public"]["Enums"]["message_sender"]
          sent_at?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "support_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      support_threads: {
        Row: {
          created_at: string
          driver_id: string
          id: string
          status: Database["public"]["Enums"]["thread_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          id?: string
          status?: Database["public"]["Enums"]["thread_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          id?: string
          status?: Database["public"]["Enums"]["thread_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_threads_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          category: string
          created_at: string
          driver_id: string
          id: string
          issue: string
          status: Database["public"]["Enums"]["support_ticket_status"]
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          driver_id: string
          id?: string
          issue: string
          status?: Database["public"]["Enums"]["support_ticket_status"]
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          driver_id?: string
          id?: string
          issue?: string
          status?: Database["public"]["Enums"]["support_ticket_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_types: {
        Row: {
          is_active: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order: number
        }
        Insert: {
          is_active?: boolean
          key: string
          label_ar: string
          label_en: string
          sort_order?: number
        }
        Update: {
          is_active?: boolean
          key?: string
          label_ar?: string
          label_en?: string
          sort_order?: number
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          bike_id: string
          created_at: string
          created_by: string | null
          current_driver_id: string | null
          id: string
          make: string | null
          model: string | null
          project_type: Database["public"]["Enums"]["project_type"]
          reg_number: string | null
          status: Database["public"]["Enums"]["vehicle_status"]
          updated_at: string
          vehicle_type_key: string
        }
        Insert: {
          bike_id: string
          created_at?: string
          created_by?: string | null
          current_driver_id?: string | null
          id?: string
          make?: string | null
          model?: string | null
          project_type?: Database["public"]["Enums"]["project_type"]
          reg_number?: string | null
          status?: Database["public"]["Enums"]["vehicle_status"]
          updated_at?: string
          vehicle_type_key?: string
        }
        Update: {
          bike_id?: string
          created_at?: string
          created_by?: string | null
          current_driver_id?: string | null
          id?: string
          make?: string | null
          model?: string | null
          project_type?: Database["public"]["Enums"]["project_type"]
          reg_number?: string | null
          status?: Database["public"]["Enums"]["vehicle_status"]
          updated_at?: string
          vehicle_type_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_current_driver_id_fkey"
            columns: ["current_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_vehicle_type_key_fkey"
            columns: ["vehicle_type_key"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["key"]
          },
        ]
      }
      verification_balances: {
        Row: {
          balance_count: number
          driver_id: string
          last_verification_id: string | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          balance_count?: number
          driver_id: string
          last_verification_id?: string | null
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          balance_count?: number
          driver_id?: string
          last_verification_id?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_balances_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_balances_last_verification_id_fkey"
            columns: ["last_verification_id"]
            isOneToOne: false
            referencedRelation: "delivery_verifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_balances_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_import_batches: {
        Row: {
          applied_count: number
          file_name: string
          id: string
          mapping: Json
          reverted_at: string | null
          reverted_by: string | null
          row_count: number
          skipped_count: number
          status: Database["public"]["Enums"]["verification_import_batch_status"]
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          applied_count?: number
          file_name: string
          id?: string
          mapping?: Json
          reverted_at?: string | null
          reverted_by?: string | null
          row_count?: number
          skipped_count?: number
          status?: Database["public"]["Enums"]["verification_import_batch_status"]
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          applied_count?: number
          file_name?: string
          id?: string
          mapping?: Json
          reverted_at?: string | null
          reverted_by?: string | null
          row_count?: number
          skipped_count?: number
          status?: Database["public"]["Enums"]["verification_import_batch_status"]
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_import_batches_reverted_by_fkey"
            columns: ["reverted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_blocked_dates: {
        Row: {
          blocked_date: string
          branch_id: string | null
          created_at: string
          created_by: string | null
          id: string
          reason: string | null
        }
        Insert: {
          blocked_date: string
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
        }
        Update: {
          blocked_date?: string
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visit_blocked_dates_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "visit_branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_blocked_dates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_booking_notes: {
        Row: {
          author_id: string | null
          body: string
          booking_id: string
          created_at: string
          id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          booking_id: string
          created_at?: string
          id?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          booking_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_booking_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_booking_notes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "visit_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_bookings: {
        Row: {
          booking_code: string
          branch_id: string | null
          cancelled_at: string | null
          checked_in_at: string | null
          completed_at: string | null
          created_at: string
          department_key: string
          driver_id: string
          id: string
          note: string | null
          note_to_rider: string | null
          rescheduled_from_id: string | null
          scheduled_date: string
          slot_id: string
          status: Database["public"]["Enums"]["visit_booking_status"]
          updated_at: string
        }
        Insert: {
          booking_code: string
          branch_id?: string | null
          cancelled_at?: string | null
          checked_in_at?: string | null
          completed_at?: string | null
          created_at?: string
          department_key: string
          driver_id: string
          id?: string
          note?: string | null
          note_to_rider?: string | null
          rescheduled_from_id?: string | null
          scheduled_date: string
          slot_id: string
          status?: Database["public"]["Enums"]["visit_booking_status"]
          updated_at?: string
        }
        Update: {
          booking_code?: string
          branch_id?: string | null
          cancelled_at?: string | null
          checked_in_at?: string | null
          completed_at?: string | null
          created_at?: string
          department_key?: string
          driver_id?: string
          id?: string
          note?: string | null
          note_to_rider?: string | null
          rescheduled_from_id?: string | null
          scheduled_date?: string
          slot_id?: string
          status?: Database["public"]["Enums"]["visit_booking_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_bookings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "visit_branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_bookings_department_key_fkey"
            columns: ["department_key"]
            isOneToOne: false
            referencedRelation: "visit_departments"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "visit_bookings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_bookings_rescheduled_from_id_fkey"
            columns: ["rescheduled_from_id"]
            isOneToOne: false
            referencedRelation: "visit_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_bookings_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "visit_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_branches: {
        Row: {
          address: string | null
          booking_window_days: number
          city: string | null
          closing_time: string | null
          contact_phone: string | null
          created_at: string
          default_slot_capacity: number
          desks_count: number
          id: string
          is_active: boolean
          is_default: boolean
          key: string
          lunch_end: string | null
          lunch_start: string | null
          name: string
          opening_time: string | null
          slot_buffer_minutes: number
          slot_length_minutes: number
          sort_order: number
          updated_at: string
          working_days: string | null
          working_dows: number[]
          working_hours: string | null
        }
        Insert: {
          address?: string | null
          booking_window_days?: number
          city?: string | null
          closing_time?: string | null
          contact_phone?: string | null
          created_at?: string
          default_slot_capacity?: number
          desks_count?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          key: string
          lunch_end?: string | null
          lunch_start?: string | null
          name: string
          opening_time?: string | null
          slot_buffer_minutes?: number
          slot_length_minutes?: number
          sort_order?: number
          updated_at?: string
          working_days?: string | null
          working_dows?: number[]
          working_hours?: string | null
        }
        Update: {
          address?: string | null
          booking_window_days?: number
          city?: string | null
          closing_time?: string | null
          contact_phone?: string | null
          created_at?: string
          default_slot_capacity?: number
          desks_count?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          key?: string
          lunch_end?: string | null
          lunch_start?: string | null
          name?: string
          opening_time?: string | null
          slot_buffer_minutes?: number
          slot_length_minutes?: number
          sort_order?: number
          updated_at?: string
          working_days?: string | null
          working_dows?: number[]
          working_hours?: string | null
        }
        Relationships: []
      }
      visit_departments: {
        Row: {
          assigned_staff_name: string | null
          avg_handling_minutes: number | null
          branch_id: string | null
          created_at: string
          desk_location: string | null
          desks_count: number
          id: string
          is_active: boolean
          key: string
          label_ar: string | null
          label_en: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          assigned_staff_name?: string | null
          avg_handling_minutes?: number | null
          branch_id?: string | null
          created_at?: string
          desk_location?: string | null
          desks_count?: number
          id?: string
          is_active?: boolean
          key: string
          label_ar?: string | null
          label_en: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          assigned_staff_name?: string | null
          avg_handling_minutes?: number | null
          branch_id?: string | null
          created_at?: string
          desk_location?: string | null
          desks_count?: number
          id?: string
          is_active?: boolean
          key?: string
          label_ar?: string | null
          label_en?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_departments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "visit_branches"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_slots: {
        Row: {
          branch_id: string | null
          capacity: number
          created_at: string
          day_of_week: number | null
          department_key: string | null
          end_time: string
          id: string
          is_active: boolean
          slot_date: string | null
          start_time: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          capacity?: number
          created_at?: string
          day_of_week?: number | null
          department_key?: string | null
          end_time: string
          id?: string
          is_active?: boolean
          slot_date?: string | null
          start_time: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          capacity?: number
          created_at?: string
          day_of_week?: number | null
          department_key?: string | null
          end_time?: string
          id?: string
          is_active?: boolean
          slot_date?: string | null
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_slots_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "visit_branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_slots_department_key_fkey"
            columns: ["department_key"]
            isOneToOne: false
            referencedRelation: "visit_departments"
            referencedColumns: ["key"]
          },
        ]
      }
      wrong_actions: {
        Row: {
          action_type: Database["public"]["Enums"]["wrong_action_type"]
          created_at: string
          created_by: string | null
          details: string | null
          driver_id: string
          id: string
          occurred_at: string
          severity: Database["public"]["Enums"]["severity_level"]
          source: Database["public"]["Enums"]["wrong_action_source"]
          updated_at: string
        }
        Insert: {
          action_type: Database["public"]["Enums"]["wrong_action_type"]
          created_at?: string
          created_by?: string | null
          details?: string | null
          driver_id: string
          id?: string
          occurred_at?: string
          severity?: Database["public"]["Enums"]["severity_level"]
          source?: Database["public"]["Enums"]["wrong_action_source"]
          updated_at?: string
        }
        Update: {
          action_type?: Database["public"]["Enums"]["wrong_action_type"]
          created_at?: string
          created_by?: string | null
          details?: string | null
          driver_id?: string
          id?: string
          occurred_at?: string
          severity?: Database["public"]["Enums"]["severity_level"]
          source?: Database["public"]["Enums"]["wrong_action_source"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wrong_actions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wrong_actions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      zone_geofence_settings: {
        Row: {
          alert_on_dwell: boolean
          alert_on_entry: boolean
          alert_on_exit: boolean
          assign_to_all_drivers: boolean
          created_at: string
          description: string | null
          driver_group_label: string | null
          dwell_time_seconds: number
          geofence_kind: string
          notify_email: boolean
          notify_in_app: boolean
          notify_sms: boolean
          status: string
          updated_at: string
          zone_id: string
        }
        Insert: {
          alert_on_dwell?: boolean
          alert_on_entry?: boolean
          alert_on_exit?: boolean
          assign_to_all_drivers?: boolean
          created_at?: string
          description?: string | null
          driver_group_label?: string | null
          dwell_time_seconds?: number
          geofence_kind?: string
          notify_email?: boolean
          notify_in_app?: boolean
          notify_sms?: boolean
          status?: string
          updated_at?: string
          zone_id: string
        }
        Update: {
          alert_on_dwell?: boolean
          alert_on_entry?: boolean
          alert_on_exit?: boolean
          assign_to_all_drivers?: boolean
          created_at?: string
          description?: string | null
          driver_group_label?: string | null
          dwell_time_seconds?: number
          geofence_kind?: string
          notify_email?: boolean
          notify_in_app?: boolean
          notify_sms?: boolean
          status?: string
          updated_at?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_geofence_settings_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: true
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      zones: {
        Row: {
          code: string
          color: string
          company_id: string | null
          created_at: string
          geometry: Json | null
          id: string
          name: string
          updated_at: string
          zone_type: Database["public"]["Enums"]["zone_geometry_type"]
        }
        Insert: {
          code: string
          color?: string
          company_id?: string | null
          created_at?: string
          geometry?: Json | null
          id?: string
          name: string
          updated_at?: string
          zone_type?: Database["public"]["Enums"]["zone_geometry_type"]
        }
        Update: {
          code?: string
          color?: string
          company_id?: string | null
          created_at?: string
          geometry?: Json | null
          id?: string
          name?: string
          updated_at?: string
          zone_type?: Database["public"]["Enums"]["zone_geometry_type"]
        }
        Relationships: [
          {
            foreignKeyName: "zones_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_attendance_daily: {
        Row: {
          attendance_log_id: string | null
          attendance_status: string | null
          check_in_at: string | null
          check_out_at: string | null
          check_out_reason: string | null
          compliance_score: number | null
          driver_code: string | null
          driver_id: string | null
          driver_name: string | null
          driver_phone: string | null
          duty_seconds: number | null
          employee_id: string | null
          gps_accuracy_meters: number | null
          gps_is_mocked: boolean | null
          gps_zone_status: string | null
          is_on_duty: boolean | null
          last_seen_at: string | null
          live_status: string | null
          log_date: string | null
          minutes_early_out: number | null
          minutes_late: number | null
          online_seconds: number | null
          partner_id: string | null
          partner_name: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          shift_type: string | null
          zone_id: string | null
          zone_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      v_attendance_exceptions: {
        Row: {
          current_status: string | null
          detected_at: string | null
          driver_code: string | null
          driver_id: string | null
          driver_name: string | null
          duration_seconds: number | null
          employee_id: string | null
          exception_date: string | null
          exception_key: string | null
          exception_type: string | null
          partner_name: string | null
          resolution_status: string | null
          severity: string | null
          supervisor_action: string | null
          supervisor_id: string | null
          supervisor_note: string | null
          zone_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_exception_actions_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_live_operations: {
        Row: {
          attendance_log_id: string | null
          attendance_status: string | null
          check_in_at: string | null
          check_out_at: string | null
          check_out_reason: string | null
          compliance_score: number | null
          driver_code: string | null
          driver_id: string | null
          driver_name: string | null
          driver_phone: string | null
          duty_seconds: number | null
          employee_id: string | null
          gps_accuracy_meters: number | null
          gps_is_mocked: boolean | null
          gps_zone_status: string | null
          is_on_duty: boolean | null
          last_seen_at: string | null
          live_status: string | null
          log_date: string | null
          minutes_early_out: number | null
          minutes_late: number | null
          online_seconds: number | null
          partner_id: string | null
          partner_name: string | null
          scheduled_end_at: string | null
          scheduled_start_at: string | null
          shift_type: string | null
          zone_id: string | null
          zone_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _admin_purge_require_super_admin: { Args: never; Returns: undefined }
      _attendance_apply_checkout: {
        Args: {
          p_distance_meters?: number
          p_driver_id: string
          p_now?: string
          p_reason: string
        }
        Returns: string
      }
      _delivery_parse_proof_keys: { Args: { p_raw: string }; Returns: string[] }
      _delivery_resolve_restaurant_id: {
        Args: {
          p_driver_id: string
          p_partner_id: string
          p_restaurant_id: string
        }
        Returns: string
      }
      _driver_assert_active_on_duty: {
        Args: { p_uid: string }
        Returns: {
          active_device_id: string | null
          active_device_session_id: string | null
          app_passcode: string | null
          app_version_seen_at: string | null
          archived_at: string | null
          avatar_object_key: string | null
          avatar_updated_at: string | null
          base_earnings_kwd: number | null
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          civil_id: string | null
          client_id: string | null
          client_name: string | null
          created_at: string
          current_app_channel: string | null
          current_app_platform: string | null
          current_app_version_code: number | null
          current_app_version_name: string | null
          current_lat: number | null
          current_lng: number | null
          custom_fields: Json
          driver_code: string
          employee_id: string
          id: string
          is_blocked: boolean
          is_on_duty: boolean
          joined_at: string | null
          login_verification_exempt: boolean
          nationality: string | null
          partner_id: string | null
          restaurant_id: string | null
          rider_category: Database["public"]["Enums"]["driver_rider_category"]
          status: Database["public"]["Enums"]["driver_status"]
          updated_at: string
          vehicle_id: string | null
          vehicle_type_key: string | null
          zone_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "drivers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _driver_assert_device_match: {
        Args: { p_device_id: string; p_uid: string }
        Returns: boolean
      }
      _driver_find_active_shift: {
        Args: { p_driver_id: string; p_now?: string }
        Returns: {
          created_at: string
          driver_id: string
          id: string
          session1_end: string
          session1_end_day_offset: number
          session1_start: string
          session2_end: string | null
          session2_end_day_offset: number
          session2_start: string | null
          session2_start_day_offset: number
          shift_date: string
          shift_type: string
          submitted_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "driver_daily_shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _driver_home_banner_for: { Args: { p_driver_id: string }; Returns: Json }
      _driver_restaurant_delivery_allowed: {
        Args: {
          p_driver_id: string
          p_lat: number
          p_lng: number
          p_proximity_meters: number
          p_restaurant_id: string
        }
        Returns: boolean
      }
      _driver_shift_adherence: {
        Args: { p_date: string; p_driver_id: string }
        Returns: Json
      }
      _driver_shift_end_at: {
        Args: {
          p_row: Database["public"]["Tables"]["driver_daily_shifts"]["Row"]
        }
        Returns: string
      }
      _driver_shift_row_for_adherence: {
        Args: { p_date: string; p_driver_id: string; p_now?: string }
        Returns: {
          created_at: string
          driver_id: string
          id: string
          session1_end: string
          session1_end_day_offset: number
          session1_start: string
          session2_end: string | null
          session2_end_day_offset: number
          session2_start: string | null
          session2_start_day_offset: number
          shift_date: string
          shift_type: string
          submitted_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "driver_daily_shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _end_driver_app_session: {
        Args: { p_driver_id: string }
        Returns: undefined
      }
      _end_driver_duty_keep_gps: {
        Args: { p_driver_id: string; p_reason?: string }
        Returns: undefined
      }
      _fleet_caller_is_service_role: { Args: never; Returns: boolean }
      _fleet_settings: { Args: never; Returns: Json }
      _haversine_meters: {
        Args: { p_lat1: number; p_lat2: number; p_lng1: number; p_lng2: number }
        Returns: number
      }
      _performance_components_snapshot: { Args: never; Returns: Json }
      _point_in_restaurant_geofence: {
        Args: {
          p_geometry: Json
          p_lat: number
          p_lng: number
          p_zone_type: Database["public"]["Enums"]["zone_geometry_type"]
        }
        Returns: boolean
      }
      _point_within_zone_proximity: {
        Args: {
          p_buffer_meters: number
          p_geometry: Json
          p_lat: number
          p_lng: number
          p_zone_type: Database["public"]["Enums"]["zone_geometry_type"]
        }
        Returns: boolean
      }
      _shift_end_day_offset: {
        Args: { p_end: string; p_end_day_offset?: number; p_start: string }
        Returns: number
      }
      _shift_row_to_json: {
        Args: {
          p_now?: string
          p_row: Database["public"]["Tables"]["driver_daily_shifts"]["Row"]
        }
        Returns: Json
      }
      _telemetry_sanitize_context: {
        Args: { p_context: Json; p_event_name: string }
        Returns: Json
      }
      _zone_geography_from_feature: {
        Args: {
          p_geometry: Json
          p_zone_type: Database["public"]["Enums"]["zone_geometry_type"]
        }
        Returns: unknown
      }
      admin_app_release_adoption: {
        Args: { p_channel?: string; p_platform?: string }
        Returns: Json
      }
      admin_app_release_drivers: {
        Args: {
          p_channel?: string
          p_limit?: number
          p_offset?: number
          p_platform?: string
          p_search?: string
          p_version_code?: number
        }
        Returns: Json
      }
      admin_approve_driver: {
        Args: { p_email: string; p_intake_id: string; p_user_id: string }
        Returns: Json
      }
      admin_attendance_kpis: {
        Args: {
          p_date: string
          p_partner_id?: string
          p_restaurant_id?: string
          p_zone_id?: string
        }
        Returns: Json
      }
      admin_auto_close_requests: { Args: never; Returns: number }
      admin_bulk_update_deliveries: {
        Args: { p_ids: string[]; p_reason?: string; p_status: string }
        Returns: Json
      }
      admin_clear_request_attention: {
        Args: { p_request_id: string }
        Returns: Json
      }
      admin_correct_attendance: {
        Args: {
          p_check_in_at?: string
          p_check_out_at?: string
          p_driver_id?: string
          p_log_date?: string
          p_log_id?: string
          p_note?: string
          p_status?: Database["public"]["Enums"]["attendance_status"]
        }
        Returns: Json
      }
      admin_count_eligible_deliveries_on_dates: {
        Args: {
          p_dates: string[]
          p_driver_id: string
          p_incentive_rule_id: string
        }
        Returns: number
      }
      admin_count_requests_by_type: { Args: never; Returns: Json }
      admin_create_appointment: {
        Args: {
          p_driver_id: string
          p_location_label?: string
          p_reason?: string
          p_scheduled_for: string
          p_slot_id?: string
          p_title?: string
        }
        Returns: Json
      }
      admin_create_esign_request: {
        Args: {
          p_category_key?: string
          p_document_storage_key?: string
          p_driver_id: string
          p_due_at?: string
          p_screenshot_restricted?: boolean
          p_title: string
        }
        Returns: Json
      }
      admin_create_request: {
        Args: {
          p_amount_kwd?: number
          p_attachments?: Json
          p_details?: string
          p_driver_id: string
          p_end_date?: string
          p_payload?: Json
          p_severity?: Database["public"]["Enums"]["severity_level"]
          p_start_date?: string
          p_type: string
        }
        Returns: Json
      }
      admin_decide_request: {
        Args: {
          p_action: string
          p_meta?: Json
          p_reason?: string
          p_request_id: string
        }
        Returns: Json
      }
      admin_delete_driver_performance_rating: {
        Args: {
          p_criterion_id: string
          p_driver_id: string
          p_period_month: string
        }
        Returns: Json
      }
      admin_delete_performance_rating_criterion: {
        Args: { p_id: string }
        Returns: Json
      }
      admin_dpd_live_snapshot: { Args: { p_date?: string }; Returns: Json }
      admin_driver_device_overview: {
        Args: { p_driver_id: string; p_history_limit?: number }
        Returns: Json
      }
      admin_driver_performance_daily: {
        Args: { p_driver_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      admin_drivers_multi_device_recent: {
        Args: { p_days?: number }
        Returns: {
          device_count: number
          driver_id: string
          latest_activity_at: string
        }[]
      }
      admin_expire_esign_requests: { Args: never; Returns: number }
      admin_expire_stale_pickups: { Args: never; Returns: number }
      admin_force_sign_out_driver: {
        Args: { p_driver_id: string }
        Returns: undefined
      }
      admin_get_driver_day_route: {
        Args: { p_date?: string; p_driver_id: string; p_tolerance_m?: number }
        Returns: Json
      }
      admin_get_request: { Args: { p_request_id: string }; Returns: Json }
      admin_get_shift_adherence: {
        Args: { p_date: string; p_driver_id: string }
        Returns: Json
      }
      admin_ingest_driver_positions: { Args: { p_events: Json }; Returns: Json }
      admin_list_attendance_daily: {
        Args: {
          p_from: string
          p_limit?: number
          p_live_only?: boolean
          p_offset?: number
          p_partner_id?: string
          p_restaurant_id?: string
          p_search?: string
          p_sort?: string
          p_status?: string
          p_to: string
          p_zone_id?: string
        }
        Returns: Json
      }
      admin_list_attendance_exceptions: {
        Args: {
          p_date?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_unresolved_only?: boolean
        }
        Returns: Json
      }
      admin_list_driver_performance: {
        Args: {
          p_driver_id?: string
          p_driver_status?: string
          p_from: string
          p_limit?: number
          p_offset?: number
          p_partner_id?: string
          p_restaurant_id?: string
          p_search?: string
          p_sort?: string
          p_to: string
          p_zone_id?: string
        }
        Returns: Json
      }
      admin_list_driver_performance_ratings: {
        Args: { p_driver_id: string; p_period_month?: string }
        Returns: Json
      }
      admin_list_esign_requests: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: Json
      }
      admin_list_fleet_events: {
        Args: {
          p_cursor_detected_at?: string
          p_cursor_id?: number
          p_driver_id?: string
          p_event_keys?: string[]
          p_from?: string
          p_limit?: number
          p_severities?: string[]
          p_to?: string
        }
        Returns: Json
      }
      admin_list_performance_components: { Args: never; Returns: Json }
      admin_list_performance_rating_teams: { Args: never; Returns: Json }
      admin_list_requests: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_department_key?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
          p_type?: string
          p_zone_id?: string
        }
        Returns: Json
      }
      admin_list_shift_adherence: {
        Args: { p_driver_ids?: string[]; p_from: string; p_to: string }
        Returns: {
          attendance_date: string
          driver_id: string
          shift_adherence: Json
        }[]
      }
      admin_list_visits: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
          p_status?: string
        }
        Returns: Json
      }
      admin_live_fleet_snapshot: {
        Args: { p_seen_within_minutes?: number }
        Returns: Json
      }
      admin_performance_trend: {
        Args: {
          p_bucket?: string
          p_from: string
          p_partner_id?: string
          p_to: string
          p_zone_id?: string
        }
        Returns: Json
      }
      admin_preview_purge: {
        Args: { p_entity_type: string; p_ids: string[] }
        Returns: Json
      }
      admin_purge_asset_catalog: { Args: { p_ids: string[] }; Returns: Json }
      admin_purge_deliveries: { Args: { p_ids: string[] }; Returns: Json }
      admin_purge_delivery_rules: { Args: { p_ids: string[] }; Returns: Json }
      admin_purge_drivers: { Args: { p_ids: string[] }; Returns: Json }
      admin_purge_incentive_rules: { Args: { p_ids: string[] }; Returns: Json }
      admin_purge_intakes: { Args: { p_ids: string[] }; Returns: Json }
      admin_purge_restaurants: { Args: { p_ids: string[] }; Returns: Json }
      admin_purge_zones: { Args: { p_ids: string[] }; Returns: Json }
      admin_rebuild_driver_performance_daily: {
        Args: { p_driver_id?: string; p_from: string; p_to: string }
        Returns: number
      }
      admin_record_fleet_events: { Args: { p_events: Json }; Returns: Json }
      admin_request_department_report: {
        Args: { p_date_from?: string; p_date_to?: string }
        Returns: Json
      }
      admin_reschedule_visit: {
        Args: {
          p_booking_id: string
          p_new_date: string
          p_new_slot_id: string
        }
        Returns: Json
      }
      admin_resolve_driver_incentive_target: {
        Args: { p_driver_id: string; p_on_date: string }
        Returns: {
          period: Database["public"]["Enums"]["incentive_period"]
          rule_id: string
          target_deliveries: number
        }[]
      }
      admin_run_attendance_auto_checkout: { Args: never; Returns: number }
      admin_run_performance_daily_rollup: {
        Args: { p_lookback_days?: number }
        Returns: Json
      }
      admin_run_request_sla_sweep: { Args: never; Returns: number }
      admin_set_driver_performance_rating_note: {
        Args: {
          p_comment: string
          p_driver_id: string
          p_period_month: string
          p_team_key: string
        }
        Returns: Json
      }
      admin_set_fuel_transfer_type: {
        Args: { p_request_id: string; p_transfer_type: string }
        Returns: Json
      }
      admin_set_performance_team_member: {
        Args: { p_member: boolean; p_profile_id: string; p_team_key: string }
        Returns: Json
      }
      admin_set_request_decision_meta: {
        Args: { p_meta: Json; p_request_id: string }
        Returns: Json
      }
      admin_update_performance_components: {
        Args: { p_components: Json; p_settings?: Json }
        Returns: Json
      }
      admin_update_visit_status: {
        Args: {
          p_booking_id: string
          p_new_date?: string
          p_new_slot_id?: string
          p_status: Database["public"]["Enums"]["visit_booking_status"]
        }
        Returns: Json
      }
      admin_upsert_driver_performance_rating: {
        Args: {
          p_criterion_id: string
          p_driver_id: string
          p_period_month: string
          p_score: number
        }
        Returns: Json
      }
      admin_upsert_exception_action: {
        Args: {
          p_action?: string
          p_driver_id: string
          p_exception_date: string
          p_exception_key: string
          p_exception_type: string
          p_note?: string
          p_resolution_status: string
        }
        Returns: Json
      }
      admin_upsert_performance_rating_criterion: {
        Args: {
          p_id: string
          p_is_active: boolean
          p_key: string
          p_label_ar: string
          p_label_en: string
          p_sort_order: number
          p_team_key: string
          p_weight: number
        }
        Returns: Json
      }
      admin_upsert_step_template: {
        Args: { p_request_type: string; p_steps: Json }
        Returns: Json
      }
      allocate_appointment_code: { Args: never; Returns: string }
      allocate_driver_code: { Args: never; Returns: string }
      allocate_esign_code: { Args: never; Returns: string }
      allocate_request_code: { Args: never; Returns: string }
      allocate_visit_booking_code: { Args: never; Returns: string }
      approve_payout_run: { Args: { p_run_id: string }; Returns: undefined }
      archive_driver_intake: { Args: { p_intake_id: string }; Returns: Json }
      assert_external_order_id: { Args: { p_raw: string }; Returns: string }
      claim_driver_import_chunk: {
        Args: { p_id: string; p_size: number }
        Returns: Json
      }
      claim_super_admin: { Args: { p_user_id: string }; Returns: boolean }
      cleanup_driver_location_events: {
        Args: { p_batch?: number; p_keep?: string }
        Returns: number
      }
      cleanup_driver_operation_events: {
        Args: { p_batch?: number; p_keep?: string }
        Returns: number
      }
      cleanup_driver_telemetry_events: {
        Args: { p_batch?: number; p_keep?: string }
        Returns: number
      }
      cleanup_fleet_events: {
        Args: { p_batch?: number; p_keep?: string }
        Returns: number
      }
      cleanup_stale_driver_locations: {
        Args: { p_max_age?: string }
        Returns: number
      }
      compile_notification_audience: {
        Args: {
          p_campaign_id: string
          p_exclusion_spec?: Json
          p_target_spec: Json
        }
        Returns: string
      }
      compile_notification_audience_ids: {
        Args: {
          p_exclusion_spec?: Json
          p_import_spec?: Json
          p_target_spec: Json
        }
        Returns: string[]
      }
      compute_incentive_amount: {
        Args: { p_eligible_count: number; p_rule_id: string }
        Returns: number
      }
      count_eligible_deliveries: {
        Args: {
          p_driver_id: string
          p_earn_date: string
          p_incentive_rule_id: string
        }
        Returns: number
      }
      count_progress_deliveries: {
        Args: {
          p_driver_id: string
          p_earn_date: string
          p_incentive_rule_id: string
        }
        Returns: number
      }
      delivery_matches_rules: {
        Args: { p_delivery_id: string; p_on_date?: string }
        Returns: boolean
      }
      delivery_progress_matches_rules: {
        Args: { p_delivery_id: string; p_on_date?: string }
        Returns: boolean
      }
      delivery_rule_matches_driver: {
        Args: { p_driver_id: string; p_rule_id: string }
        Returns: boolean
      }
      delivery_scope_restaurant_id: {
        Args: {
          p_driver_id: string
          p_lat: number
          p_lng: number
          p_restaurant_id: string
        }
        Returns: string
      }
      driver_acknowledge_request: {
        Args: { p_attachment_keys?: string[]; p_note?: string; p_request_id: string }
        Returns: Json
      }
      driver_app_lookup_by_passcode: {
        Args: { p_driver_code: string; p_passcode: string }
        Returns: Json
      }
      driver_book_visit: {
        Args: {
          p_date: string
          p_department_key: string
          p_note?: string
          p_slot_id: string
        }
        Returns: Json
      }
      driver_cancel_delivery: {
        Args: {
          p_cancel_lat?: number
          p_cancel_lng?: number
          p_cancel_proof_url?: string
          p_cancel_reason?: string
          p_delivery_id: string
          p_device_id?: string
        }
        Returns: {
          cancel_lat: number | null
          cancel_lng: number | null
          cancel_proof_url: string | null
          cancel_proof_urls: string[]
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          delivered_lat: number | null
          delivered_lng: number | null
          driver_id: string
          external_order_id: string | null
          id: string
          order_proof_url: string | null
          order_proof_urls: string[]
          partner_id: string | null
          pickup_at: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_proof_url: string | null
          pickup_proof_urls: string[]
          rejection_reason: string | null
          restaurant_id: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          updated_at: string
          zone_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_cancel_visit: { Args: { p_booking_id: string }; Returns: Json }
      driver_check_order_id_available: {
        Args: { p_external_order_id: string }
        Returns: boolean
      }
      driver_clear_live_location: { Args: never; Returns: Json }
      driver_complete_delivery: {
        Args: {
          p_delivered_lat?: number
          p_delivered_lng?: number
          p_delivery_id: string
          p_delivery_proof_url?: string
          p_device_id?: string
        }
        Returns: {
          cancel_lat: number | null
          cancel_lng: number | null
          cancel_proof_url: string | null
          cancel_proof_urls: string[]
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          delivered_lat: number | null
          delivered_lng: number | null
          driver_id: string
          external_order_id: string | null
          id: string
          order_proof_url: string | null
          order_proof_urls: string[]
          partner_id: string | null
          pickup_at: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_proof_url: string | null
          pickup_proof_urls: string[]
          rejection_reason: string | null
          restaurant_id: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          updated_at: string
          zone_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_create_delivery: {
        Args: {
          p_delivered_lat?: number
          p_delivered_lng?: number
          p_external_order_id?: string
          p_order_proof_url?: string
        }
        Returns: {
          cancel_lat: number | null
          cancel_lng: number | null
          cancel_proof_url: string | null
          cancel_proof_urls: string[]
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          delivered_lat: number | null
          delivered_lng: number | null
          driver_id: string
          external_order_id: string | null
          id: string
          order_proof_url: string | null
          order_proof_urls: string[]
          partner_id: string | null
          pickup_at: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_proof_url: string | null
          pickup_proof_urls: string[]
          rejection_reason: string | null
          restaurant_id: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          updated_at: string
          zone_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_create_pickup: {
        Args: {
          p_device_id?: string
          p_external_order_id?: string
          p_order_proof_url?: string
          p_pickup_lat?: number
          p_pickup_lng?: number
        }
        Returns: {
          cancel_lat: number | null
          cancel_lng: number | null
          cancel_proof_url: string | null
          cancel_proof_urls: string[]
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          delivered_lat: number | null
          delivered_lng: number | null
          driver_id: string
          external_order_id: string | null
          id: string
          order_proof_url: string | null
          order_proof_urls: string[]
          partner_id: string | null
          pickup_at: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_proof_url: string | null
          pickup_proof_urls: string[]
          rejection_reason: string | null
          restaurant_id: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          updated_at: string
          zone_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_create_request: {
        Args: {
          p_amount_kwd?: number
          p_attachments?: Json
          p_details?: string
          p_end_date?: string
          p_payload?: Json
          p_severity?: Database["public"]["Enums"]["severity_level"]
          p_start_date?: string
          p_type: string
        }
        Returns: Json
      }
      driver_decline_esignature: {
        Args: { p_id: string; p_reason?: string }
        Returns: Json
      }
      driver_delivery_performance_counts: {
        Args: { p_driver_id: string }
        Returns: Json
      }
      driver_dismiss_notifications: {
        Args: { p_dispatch_item_ids?: string[] }
        Returns: number
      }
      driver_finalize_reconciliation: {
        Args: { p_device_id: string }
        Returns: undefined
      }
      driver_get_active_app_release: {
        Args: { p_channel?: string; p_platform?: string }
        Returns: Json
      }
      driver_get_active_pickup: {
        Args: never
        Returns: {
          cancel_lat: number | null
          cancel_lng: number | null
          cancel_proof_url: string | null
          cancel_proof_urls: string[]
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          delivered_lat: number | null
          delivered_lng: number | null
          driver_id: string
          external_order_id: string | null
          id: string
          order_proof_url: string | null
          order_proof_urls: string[]
          partner_id: string | null
          pickup_at: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_proof_url: string | null
          pickup_proof_urls: string[]
          rejection_reason: string | null
          restaurant_id: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          updated_at: string
          zone_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      driver_get_attendance: {
        Args: { p_month: number; p_year: number }
        Returns: Json
      }
      driver_get_delivery_proximity_context: { Args: never; Returns: Json }
      driver_get_earnings_summary: { Args: never; Returns: Json }
      driver_get_esign_request: { Args: { p_id: string }; Returns: Json }
      driver_get_extra_earnings: { Args: never; Returns: Json }
      driver_get_home_dashboard: { Args: never; Returns: Json }
      driver_get_request: { Args: { p_request_id: string }; Returns: Json }
      driver_get_today_shift: { Args: never; Returns: Json }
      driver_has_active_restaurant: {
        Args: { p_driver_id: string }
        Returns: boolean
      }
      driver_has_ops_assignment: {
        Args: { p_driver_id: string }
        Returns: boolean
      }
      driver_heartbeat: { Args: { p_device_id: string }; Returns: Json }
      driver_ingest_telemetry: { Args: { p_events: Json }; Returns: Json }
      driver_is_within_delivery_range: {
        Args: {
          p_driver_id: string
          p_lat: number
          p_lng: number
          p_proximity_meters?: number
        }
        Returns: boolean
      }
      driver_list_appointments: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      driver_list_esign_requests: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      driver_list_my_requests: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: Json
      }
      driver_list_notifications: {
        Args: { p_before?: string; p_limit?: number; p_unread_only?: boolean }
        Returns: Json
      }
      driver_list_visit_slots: {
        Args: { p_date: string; p_department_key: string }
        Returns: Json
      }
      driver_log_security_event: {
        Args: { p_context?: Json; p_event_type: string; p_severity?: string }
        Returns: string
      }
      driver_mark_esign_viewed: { Args: { p_id: string }; Returns: Json }
      driver_mark_notifications_read: {
        Args: { p_dispatch_item_ids?: string[] }
        Returns: number
      }
      driver_notifications_unread_count: { Args: never; Returns: number }
      driver_ops_audit_health: { Args: never; Returns: Json }
      driver_ops_fail: {
        Args: {
          p_category: string
          p_context?: Json
          p_driver_id: string
          p_error_code: string
          p_operation_key: string
          p_source_name: string
        }
        Returns: undefined
      }
      driver_record_app_version: {
        Args: {
          p_channel?: string
          p_platform?: string
          p_version_code?: number
          p_version_name?: string
        }
        Returns: undefined
      }
      driver_record_login_verification: {
        Args: {
          p_liveness_method?: string
          p_liveness_passed?: boolean
          p_object_key: string
        }
        Returns: Json
      }
      driver_release_device_session: {
        Args: { p_device_id: string }
        Returns: undefined
      }
      driver_report_location: {
        Args: {
          p_accuracy_meters?: number
          p_active_delivery_id?: string
          p_altitude_m?: number
          p_battery_pct?: number
          p_charging_state?: string
          p_delivery_id?: string
          p_force_history?: boolean
          p_heading_deg?: number
          p_is_mocked?: boolean
          p_latitude: number
          p_location_provider?: string
          p_longitude: number
          p_network_type?: string
          p_speed_mps?: number
          p_tracking_status?: string
        }
        Returns: Json
      }
      driver_resolve_pickup_restaurant: {
        Args: { p_driver_id: string; p_lat: number; p_lng: number }
        Returns: string
      }
      driver_respond_appointment: {
        Args: {
          p_action: string
          p_id: string
          p_note?: string
          p_proposed_for?: string
        }
        Returns: Json
      }
      driver_respond_reschedule: {
        Args: { p_accept: boolean; p_note?: string; p_request_id: string }
        Returns: Json
      }
      driver_set_duty_state: {
        Args: { p_is_on_duty: boolean; p_is_online: boolean }
        Returns: Json
      }
      driver_submit_clarification: {
        Args: {
          p_answer: string
          p_attachment_keys?: string[]
          p_request_id: string
        }
        Returns: Json
      }
      driver_submit_daily_shift: {
        Args: {
          p_session1_end: string
          p_session1_start: string
          p_session2_end?: string
          p_session2_start?: string
          p_shift_date?: string
          p_shift_type: string
        }
        Returns: Json
      }
      driver_submit_esignature: {
        Args: {
          p_id: string
          p_signature_storage_key: string
          p_signer_display_name?: string
          p_signer_meta?: Json
        }
        Returns: Json
      }
      driver_update_avatar: { Args: { p_object_key: string }; Returns: Json }
      driver_week_online_seconds: {
        Args: { p_driver_id: string; p_today: string; p_week_start: string }
        Returns: number
      }
      enqueue_notification_automation_event: {
        Args: {
          p_driver_id?: string
          p_payload?: Json
          p_trigger_type: Database["public"]["Enums"]["notification_automation_trigger"]
        }
        Returns: string
      }
      estimate_notification_audience: {
        Args: {
          p_exclusion_spec?: Json
          p_import_spec?: Json
          p_target_spec: Json
        }
        Returns: number
      }
      finalize_attendance_stale_sessions: { Args: never; Returns: number }
      generate_driver_app_passcode: { Args: never; Returns: string }
      generate_payout_run: {
        Args: {
          p_driver_ids?: string[]
          p_notes?: string
          p_period_end: string
          p_period_start: string
        }
        Returns: string
      }
      get_driver_earnings_detail: {
        Args: { p_driver_id: string; p_earn_date: string }
        Returns: Json
      }
      get_earnings_overview: {
        Args: { p_end_date: string; p_filters?: Json; p_start_date: string }
        Returns: Json
      }
      get_payout_run_detail: { Args: { p_run_id: string }; Returns: Json }
      incentive_accrues_on_date: {
        Args: {
          p_earn_date: string
          p_period: Database["public"]["Enums"]["incentive_period"]
        }
        Returns: boolean
      }
      incentive_rule_matches_driver: {
        Args: { p_driver_id: string; p_rule_id: string }
        Returns: boolean
      }
      intake_has_active_restaurant: {
        Args: { p_intake_id: string }
        Returns: boolean
      }
      intake_has_ops_assignment: {
        Args: { p_intake_id: string }
        Returns: boolean
      }
      is_admin_panel_user: { Args: never; Returns: boolean }
      is_current_driver: { Args: { driver_uuid: string }; Returns: boolean }
      is_rider: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      is_super_admin_user: { Args: never; Returns: boolean }
      kuwait_month_end: { Args: { p_date: string }; Returns: string }
      kuwait_month_start: { Args: { p_date: string }; Returns: string }
      kuwait_week_end: { Args: { p_date: string }; Returns: string }
      kuwait_week_start: { Args: { p_date: string }; Returns: string }
      list_driver_earnings_daily: {
        Args: { p_driver_id?: string; p_end_date: string; p_start_date: string }
        Returns: Json
      }
      list_earnings_grouped: {
        Args: {
          p_end_date: string
          p_filters?: Json
          p_group_by: string
          p_start_date: string
        }
        Returns: Json
      }
      log_driver_operation: {
        Args: {
          p_category: string
          p_context?: Json
          p_driver_id: string
          p_entity_id?: string
          p_entity_type?: string
          p_error_code?: string
          p_latitude?: number
          p_longitude?: number
          p_operation_key: string
          p_source?: string
          p_source_name?: string
          p_success?: boolean
        }
        Returns: undefined
      }
      log_driver_operation_autonomous: {
        Args: {
          p_category: string
          p_context?: Json
          p_driver_id: string
          p_error_code: string
          p_operation_key: string
          p_source_name: string
        }
        Returns: undefined
      }
      mark_driver_intake_linked: {
        Args: { p_phone: string; p_profile_id: string }
        Returns: boolean
      }
      mark_payout_run_paid: {
        Args: { p_paid_at?: string; p_reference?: string; p_run_id: string }
        Returns: undefined
      }
      next_restaurant_code: { Args: never; Returns: string }
      normalize_external_order_id: { Args: { p_raw: string }; Returns: string }
      notify_driver_transactional: {
        Args: {
          p_action_params?: Json
          p_body: string
          p_category?: Database["public"]["Enums"]["notification_category"]
          p_deep_link?: string
          p_driver_id: string
          p_priority?: Database["public"]["Enums"]["notification_priority"]
          p_title: string
        }
        Returns: Json
      }
      performance_daily_source: {
        Args: { p_driver_id?: string; p_from: string; p_to: string }
        Returns: {
          absent: boolean
          conduct_weighted: number
          deliveries_completed: number
          deliveries_within_sla: number
          driver_id: string
          duty_seconds: number
          gps_offline_minutes: number
          log_date: string
          lost_minutes: number
          on_leave: boolean
          online_seconds: number
          out_of_zone_minutes: number
          overspeed_events: number
          scheduled_minutes: number
          sources_complete: string[]
          worked: boolean
        }[]
      }
      preview_driver_earnings: { Args: { p_earn_date: string }; Returns: Json }
      rcm_materialize_approval_steps: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      rcm_validate_request_input: {
        Args: {
          p_amount_kwd: number
          p_attachments: Json
          p_details: string
          p_end_date: string
          p_payload: Json
          p_severity: Database["public"]["Enums"]["severity_level"]
          p_start_date: string
          p_type: string
        }
        Returns: string
      }
      recalculate_driver_earnings: {
        Args: {
          p_approved_by?: string
          p_driver_id: string
          p_earn_date: string
        }
        Returns: undefined
      }
      recalculate_earnings_for_date: {
        Args: { p_earn_date: string }
        Returns: number
      }
      recalculate_earnings_for_range: {
        Args: { p_driver_id?: string; p_end_date: string; p_start_date: string }
        Returns: number
      }
      reconcile_delivery_verification: {
        Args: { p_verification_id: string }
        Returns: undefined
      }
      record_notification_client_event: {
        Args: {
          p_campaign_id: string
          p_dispatch_item_id: string
          p_event_at?: string
          p_event_type: string
          p_metadata?: Json
        }
        Returns: undefined
      }
      regenerate_driver_app_passcode: {
        Args: { p_driver_id: string }
        Returns: Json
      }
      register_or_sync_rider_profile: {
        Args: { p_full_name: string }
        Returns: Json
      }
      report_delivery_orders: {
        Args: { p_from: string; p_from_time?: string; p_to: string; p_to_time?: string }
        Returns: {
          delivery_count: number
          driver_code: string
          driver_id: string
          employee_id: string
          full_name: string
          shift_date: string
          store_name: string
        }[]
      }
      resolve_delivery_sla_minutes: {
        Args: { p_partner_id: string; p_zone_id: string }
        Returns: number
      }
      resolve_import_driver_ids: {
        Args: { p_import_spec: Json }
        Returns: string[]
      }
      restore_driver_intake: { Args: { p_intake_id: string }; Returns: Json }
      set_driver_account_status: {
        Args: {
          p_driver_id: string
          p_status: Database["public"]["Enums"]["driver_status"]
        }
        Returns: Json
      }
      set_driver_blocked: {
        Args: { p_blocked: boolean; p_driver_id: string; p_reason?: string }
        Returns: Json
      }
      shift_session_instant: {
        Args: { p_day_offset?: number; p_shift_date: string; p_time: string }
        Returns: string
      }
      staff_has_permission: { Args: { p_slug: string }; Returns: boolean }
      staff_rates_for_team: { Args: { p_team_key: string }; Returns: boolean }
      sync_driver_wallet_earning_credit: {
        Args: {
          p_approved_by?: string
          p_driver_id: string
          p_earn_date: string
        }
        Returns: undefined
      }
      sync_intake_asset_assignments_to_driver: {
        Args: { p_driver_id: string; p_intake_id: string }
        Returns: undefined
      }
      void_payout_run: {
        Args: { p_reason?: string; p_run_id: string }
        Returns: undefined
      }
    }
    Enums: {
      admin_activity_action:
        | "create"
        | "update"
        | "delete"
        | "view"
        | "read"
        | "auth"
        | "export"
        | "recalculate"
      admin_approval_status: "pending" | "approved" | "rejected"
      app_role: "staff" | "rider"
      appointment_status:
        | "scheduled"
        | "completed"
        | "cancelled"
        | "pending"
        | "accepted"
        | "rejected"
        | "reschedule_requested"
      asset_assignment_status: "assigned" | "returned"
      asset_type:
        | "gps"
        | "sim"
        | "phone"
        | "delivery_bag"
        | "helmet"
        | "uniform"
      attendance_status: "present" | "late" | "absent" | "on_leave"
      delivery_status:
        | "pending"
        | "verified"
        | "rejected"
        | "under_review"
        | "in_transit"
        | "cancelled"
      document_type: "license" | "civil_id" | "work_permit" | "passport"
      driver_import_batch_status:
        | "previewed"
        | "applied"
        | "failed"
        | "running"
        | "paused"
        | "cancelled"
      driver_intake_status: "awaiting_app_link" | "linked" | "cancelled"
      driver_rider_category: "in_house" | "outsourced"
      driver_status: "active" | "suspended" | "pending"
      driver_workflow_status: "draft" | "pending" | "approved"
      esign_request_status:
        | "pending"
        | "signed"
        | "expired"
        | "cancelled"
        | "declined"
      hygiene_submission_status: "pending" | "completed" | "rejected"
      hygiene_task_status: "draft" | "active" | "ended"
      incentive_payout_mode: "milestone" | "cumulative"
      incentive_period: "daily" | "weekly" | "monthly"
      incentive_reward_mode: "fixed" | "per_delivery"
      incentive_target_mode: "single" | "tiered"
      message_sender: "driver" | "staff"
      notification_action_type:
        | "open_screen"
        | "open_module"
        | "open_record"
        | "open_workflow"
        | "open_url"
        | "custom_payload"
        | "silent_update_trigger"
      notification_automation_status: "draft" | "active" | "paused" | "archived"
      notification_automation_trigger:
        | "inactivity"
        | "attendance_approved"
        | "salary_processed"
        | "document_expiry"
        | "low_performance"
        | "incentive_unlocked"
        | "shift_reminder"
        | "missed_submission"
        | "schedule"
      notification_campaign_status:
        | "draft"
        | "pending_approval"
        | "scheduled"
        | "queued"
        | "processing"
        | "sent"
        | "delivered"
        | "opened"
        | "clicked"
        | "failed"
        | "cancelled"
        | "expired"
      notification_category:
        | "incentive"
        | "reminder"
        | "compliance"
        | "attendance"
        | "salary"
        | "emergency"
        | "announcement"
        | "operations"
        | "system_alert"
      notification_click_action:
        | "hygiene_task"
        | "home"
        | "deliveries"
        | "vehicle"
        | "profile"
        | "custom_link"
      notification_dispatch_item_status:
        | "pending"
        | "processing"
        | "sent"
        | "delivered"
        | "opened"
        | "clicked"
        | "failed"
        | "skipped"
      notification_event_type:
        | "queued"
        | "sent"
        | "delivered"
        | "opened"
        | "clicked"
        | "failed"
        | "cancelled"
        | "expired"
        | "screenshot_taken"
      notification_priority: "low" | "normal" | "high" | "critical"
      notification_status: "draft" | "scheduled" | "sent"
      offer_status: "draft" | "active" | "ended"
      offer_type: "daily" | "weekly" | "monthly"
      payout_run_status: "draft" | "approved" | "paid" | "voided"
      project_type: "group" | "rent"
      request_access_level: "view_only" | "approver"
      request_status:
        | "pending"
        | "approved"
        | "rejected"
        | "draft"
        | "submitted"
        | "in_review"
        | "needs_clarification"
        | "solved"
        | "overdue"
        | "rescheduled"
        | "responded"
        | "closed"
      request_step_status:
        | "pending"
        | "in_progress"
        | "completed"
        | "rejected"
        | "skipped"
      restaurant_geofence_kind: "inclusion" | "exclusion"
      restaurant_status: "draft" | "published" | "active"
      rule_scope_type: "zone" | "partner" | "restaurant"
      rule_status: "draft" | "active" | "ended"
      severity_level: "low" | "medium" | "high"
      support_ticket_status: "open" | "resolved"
      thread_status: "active" | "resolved"
      vehicle_status: "active" | "suspended" | "maintenance"
      verification_import_batch_status: "previewed" | "applied" | "reverted"
      verification_source: "manual" | "import"
      verification_status:
        | "pending"
        | "matched"
        | "surplus"
        | "deficit"
        | "conflict"
        | "reverted"
      visit_booking_status:
        | "confirmed"
        | "checked_in"
        | "completed"
        | "no_show"
        | "cancelled"
      wallet_entry_status: "approved" | "pending" | "voided"
      wallet_entry_type: "earning_credit" | "manual_adjustment" | "payout_debit"
      wrong_action_source: "system" | "admin"
      wrong_action_type:
        | "delay"
        | "zone_breach"
        | "hygiene_failed"
        | "uniform"
        | "other"
      zone_compliance: "inside" | "outside"
      zone_geometry_type: "polygon" | "circle"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      admin_activity_action: [
        "create",
        "update",
        "delete",
        "view",
        "read",
        "auth",
        "export",
        "recalculate",
      ],
      admin_approval_status: ["pending", "approved", "rejected"],
      app_role: ["staff", "rider"],
      appointment_status: [
        "scheduled",
        "completed",
        "cancelled",
        "pending",
        "accepted",
        "rejected",
        "reschedule_requested",
      ],
      asset_assignment_status: ["assigned", "returned"],
      asset_type: ["gps", "sim", "phone", "delivery_bag", "helmet", "uniform"],
      attendance_status: ["present", "late", "absent", "on_leave"],
      delivery_status: [
        "pending",
        "verified",
        "rejected",
        "under_review",
        "in_transit",
        "cancelled",
      ],
      document_type: ["license", "civil_id", "work_permit", "passport"],
      driver_import_batch_status: [
        "previewed",
        "applied",
        "failed",
        "running",
        "paused",
        "cancelled",
      ],
      driver_intake_status: ["awaiting_app_link", "linked", "cancelled"],
      driver_rider_category: ["in_house", "outsourced"],
      driver_status: ["active", "suspended", "pending"],
      driver_workflow_status: ["draft", "pending", "approved"],
      esign_request_status: [
        "pending",
        "signed",
        "expired",
        "cancelled",
        "declined",
      ],
      hygiene_submission_status: ["pending", "completed", "rejected"],
      hygiene_task_status: ["draft", "active", "ended"],
      incentive_payout_mode: ["milestone", "cumulative"],
      incentive_period: ["daily", "weekly", "monthly"],
      incentive_reward_mode: ["fixed", "per_delivery"],
      incentive_target_mode: ["single", "tiered"],
      message_sender: ["driver", "staff"],
      notification_action_type: [
        "open_screen",
        "open_module",
        "open_record",
        "open_workflow",
        "open_url",
        "custom_payload",
        "silent_update_trigger",
      ],
      notification_automation_status: ["draft", "active", "paused", "archived"],
      notification_automation_trigger: [
        "inactivity",
        "attendance_approved",
        "salary_processed",
        "document_expiry",
        "low_performance",
        "incentive_unlocked",
        "shift_reminder",
        "missed_submission",
        "schedule",
      ],
      notification_campaign_status: [
        "draft",
        "pending_approval",
        "scheduled",
        "queued",
        "processing",
        "sent",
        "delivered",
        "opened",
        "clicked",
        "failed",
        "cancelled",
        "expired",
      ],
      notification_category: [
        "incentive",
        "reminder",
        "compliance",
        "attendance",
        "salary",
        "emergency",
        "announcement",
        "operations",
        "system_alert",
      ],
      notification_click_action: [
        "hygiene_task",
        "home",
        "deliveries",
        "vehicle",
        "profile",
        "custom_link",
      ],
      notification_dispatch_item_status: [
        "pending",
        "processing",
        "sent",
        "delivered",
        "opened",
        "clicked",
        "failed",
        "skipped",
      ],
      notification_event_type: [
        "queued",
        "sent",
        "delivered",
        "opened",
        "clicked",
        "failed",
        "cancelled",
        "expired",
        "screenshot_taken",
      ],
      notification_priority: ["low", "normal", "high", "critical"],
      notification_status: ["draft", "scheduled", "sent"],
      offer_status: ["draft", "active", "ended"],
      offer_type: ["daily", "weekly", "monthly"],
      payout_run_status: ["draft", "approved", "paid", "voided"],
      project_type: ["group", "rent"],
      request_access_level: ["view_only", "approver"],
      request_status: [
        "pending",
        "approved",
        "rejected",
        "draft",
        "submitted",
        "in_review",
        "needs_clarification",
        "solved",
        "overdue",
        "rescheduled",
        "responded",
        "closed",
      ],
      request_step_status: [
        "pending",
        "in_progress",
        "completed",
        "rejected",
        "skipped",
      ],
      restaurant_geofence_kind: ["inclusion", "exclusion"],
      restaurant_status: ["draft", "published", "active"],
      rule_scope_type: ["zone", "partner", "restaurant"],
      rule_status: ["draft", "active", "ended"],
      severity_level: ["low", "medium", "high"],
      support_ticket_status: ["open", "resolved"],
      thread_status: ["active", "resolved"],
      vehicle_status: ["active", "suspended", "maintenance"],
      verification_import_batch_status: ["previewed", "applied", "reverted"],
      verification_source: ["manual", "import"],
      verification_status: [
        "pending",
        "matched",
        "surplus",
        "deficit",
        "conflict",
        "reverted",
      ],
      visit_booking_status: [
        "confirmed",
        "checked_in",
        "completed",
        "no_show",
        "cancelled",
      ],
      wallet_entry_status: ["approved", "pending", "voided"],
      wallet_entry_type: [
        "earning_credit",
        "manual_adjustment",
        "payout_debit",
      ],
      wrong_action_source: ["system", "admin"],
      wrong_action_type: [
        "delay",
        "zone_breach",
        "hygiene_failed",
        "uniform",
        "other",
      ],
      zone_compliance: ["inside", "outside"],
      zone_geometry_type: ["polygon", "circle"],
    },
  },
} as const

export type AppRole = Database["public"]["Enums"]["app_role"];
export type AdminApprovalStatus = Database["public"]["Enums"]["admin_approval_status"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
