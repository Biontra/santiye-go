-- ==============================================================================
-- ŞANTİYE GO – MESAJLAŞMA VE İLİŞKİLİ SİSTEMLER TEŞHİS SORGUSU
-- Supabase Dashboard > SQL Editor alanında doğrudan çalıştırılabilir.
-- Kişisel veri (telefon, e-posta, isim, vergi no vb.) KESİNLİKLE İÇERMEZ.
-- TEK BİR SONUÇ KÜMESİ (JSON) DÖNER.
-- ==============================================================================

SELECT jsonb_pretty(
    jsonb_build_object(
        'diagnostics_timestamp', NOW(),
        'table_row_counts', jsonb_build_object(
            'conversations', (SELECT COUNT(*) FROM public.conversations),
            'messages', (SELECT COUNT(*) FROM public.messages),
            'notifications', (SELECT COUNT(*) FROM public.notifications),
            'user_blocks', (SELECT COUNT(*) FROM public.user_blocks),
            'reports', (SELECT COUNT(*) FROM public.reports),
            'compliance_mask_logs', (SELECT COUNT(*) FROM public.compliance_mask_logs),
            'contact_reveals', (SELECT COUNT(*) FROM public.contact_reveals),
            'favorites', (SELECT COUNT(*) FROM public.favorites),
            'profiles', (SELECT COUNT(*) FROM public.profiles),
            'companies', (SELECT COUNT(*) FROM public.companies),
            'listings', (SELECT COUNT(*) FROM public.listings)
        ),
        'rls_status', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'table_name', relname,
                        'rls_enabled', relrowsecurity,
                        'rls_forced', relforcerowsecurity
                    ) ORDER BY relname
                ),
                '[]'::jsonb
            )
            FROM pg_class
            WHERE relnamespace = 'public'::regnamespace
              AND relname IN (
                'conversations','messages','notifications','user_blocks','reports',
                'compliance_mask_logs','contact_reveals','favorites'
              )
        ),
        'rls_policies', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'table_name', tablename,
                        'policy_name', policyname,
                        'command', cmd,
                        'roles', roles,
                        'permissive', permissive,
                        'using_expression', qual,
                        'with_check_expression', with_check
                    ) ORDER BY tablename, policyname
                ),
                '[]'::jsonb
            )
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename IN (
                'conversations','messages','notifications','user_blocks','reports',
                'compliance_mask_logs','contact_reveals','favorites'
              )
        ),
        'table_privileges', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'table_name', table_name,
                        'grantee', grantee,
                        'privilege_type', privilege_type
                    ) ORDER BY table_name, grantee, privilege_type
                ),
                '[]'::jsonb
            )
            FROM information_schema.table_privileges
            WHERE table_schema = 'public'
              AND table_name IN (
                'conversations','messages','notifications','user_blocks','reports',
                'compliance_mask_logs','contact_reveals','favorites'
              )
              AND grantee IN ('anon', 'authenticated')
        ),
        'triggers', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'table_name', event_object_table,
                        'trigger_name', trigger_name,
                        'event_manipulation', event_manipulation,
                        'action_timing', action_timing,
                        'action_statement', action_statement
                    ) ORDER BY event_object_table, trigger_name
                ),
                '[]'::jsonb
            )
            FROM information_schema.triggers
            WHERE event_object_schema = 'public'
              AND event_object_table IN (
                'conversations','messages','notifications','user_blocks','reports',
                'compliance_mask_logs','contact_reveals','favorites'
              )
        ),
        'realtime_publication_tables', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'schemaname', schemaname,
                        'tablename', tablename
                    ) ORDER BY tablename
                ),
                '[]'::jsonb
            )
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
        ),
        'rpc_functions', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'function_name', r.routine_name,
                        'routine_type', r.routine_type,
                        'return_type', r.data_type,
                        'security_type', r.security_type,
                        'grants', (
                            SELECT COALESCE(
                                jsonb_agg(
                                    jsonb_build_object(
                                        'grantee', p.grantee,
                                        'privilege_type', p.privilege_type
                                    )
                                ),
                                '[]'::jsonb
                            )
                            FROM information_schema.routine_privileges p
                            WHERE p.routine_schema = 'public'
                              AND p.routine_name = r.routine_name
                              AND p.grantee IN ('anon', 'authenticated', 'PUBLIC')
                        )
                    ) ORDER BY r.routine_name
                ),
                '[]'::jsonb
            )
            FROM information_schema.routines r
            WHERE r.routine_schema = 'public'
              AND (
                r.routine_name ILIKE '%message%'
                OR r.routine_name ILIKE '%conversation%'
                OR r.routine_name ILIKE '%reveal%'
                OR r.routine_name ILIKE '%block%'
                OR r.routine_name ILIKE '%report%'
                OR r.routine_name ILIKE '%notif%'
              )
        ),
        'foreign_keys_and_constraints', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'table_name', tc.table_name,
                        'constraint_name', tc.constraint_name,
                        'constraint_type', tc.constraint_type,
                        'column_name', kcu.column_name,
                        'foreign_table', ccu.table_name,
                        'foreign_column', ccu.column_name,
                        'delete_rule', rc.delete_rule
                    ) ORDER BY tc.table_name, tc.constraint_name
                ),
                '[]'::jsonb
            )
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            LEFT JOIN information_schema.referential_constraints rc
              ON tc.constraint_name = rc.constraint_name
            LEFT JOIN information_schema.constraint_column_usage ccu
              ON rc.unique_constraint_name = ccu.constraint_name
            WHERE tc.table_schema = 'public'
              AND tc.table_name IN ('conversations', 'messages', 'user_blocks', 'reports', 'notifications')
        )
    )
) AS messaging_diagnostics_report;
