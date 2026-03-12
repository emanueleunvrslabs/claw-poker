import { createClient } from '@supabase/supabase-js'
import { config } from '../config'

export const db = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
