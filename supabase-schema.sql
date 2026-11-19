-- ============================================================================
-- JASMIN DIGITAL - TEK MASTER SUPABASE SCHEMA & GÜVENLİK DOSYASI
-- Mevcut verilere zarar vermez (defalarca güvenle çalıştırılabilir).
-- ============================================================================

-- 1. POSTS (Drive Linkleri)
CREATE TABLE IF NOT EXISTS public.posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz DEFAULT now(),
    name text NOT NULL,
    image_url text,
    drive_url text,
    instagram_url text,
    has_new boolean DEFAULT false
);

-- 2. JOBS (Kanban İş Takibi: todo / approval / done)
CREATE TABLE IF NOT EXISTS public.jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    title text NOT NULL,
    is_completed boolean DEFAULT false,
    position integer DEFAULT 0,
    status text DEFAULT 'todo'
);

-- Eski jobs tablosunda status sütunu yoksa ekle ve mevcut kayıtları senkronize et
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS status text DEFAULT 'todo';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS position integer DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.jobs
SET status = CASE WHEN is_completed THEN 'done' ELSE 'todo' END
WHERE status IS NULL OR status NOT IN ('todo', 'approval', 'done');

-- 3. SHOOTINGS (Çekim Takvimi)
CREATE TABLE IF NOT EXISTS public.shootings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz DEFAULT now(),
    name text NOT NULL,
    date date NOT NULL,
    time time NOT NULL
);

-- 4. VAULT (Müşteri Şifreleri - Sadece giriş yapan admin erişebilir)
CREATE TABLE IF NOT EXISTS public.vault (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz DEFAULT now(),
    title text NOT NULL,
    instagram text,
    username text,
    password text
);

-- 5. SUNUM CLIENTS & POSTS
CREATE TABLE IF NOT EXISTS public.sunum_clients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz DEFAULT now(),
    name text NOT NULL,
    slug text UNIQUE NOT NULL,
    subtitle text
);

CREATE TABLE IF NOT EXISTS public.sunum_posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz DEFAULT now(),
    client_id uuid REFERENCES public.sunum_clients(id) ON DELETE CASCADE,
    media_url text,
    type text DEFAULT 'image',
    "order" integer DEFAULT 0,
    carousel_data jsonb
);

-- 6. VAULT TABLOSU GERÇEK GÜVENLİK (RLS)
-- Eski açık politikaları otomatik temizler, sadece Supabase Auth ile giriş yapanlara açar.
-- NOT: Önce Supabase > Authentication > Users > Add User bölümünden
--      admin@jasmindigital.com kullanıcısını (Auto Confirm işaretli) oluşturun!
ALTER TABLE public.vault ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'vault'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.vault;', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "vault_authenticated_only"
    ON public.vault
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- 7. MEDIA STORAGE BUCKET (Sunum yüklemeleri için)
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

