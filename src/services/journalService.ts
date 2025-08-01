
import { supabase } from '@/integrations/supabase/client';
import type { Entry } from '@/types/entry';
import { validateEntryContent, validatePhotos, validateTags } from '@/utils/validation';
import { uploadPhotos, checkPhotoLimit, deleteEntryPhotos } from '@/utils/photoUpload';
import { encrypt, decrypt } from '@/utils/encryption';

export const fetchJournalEntries = async (userId: string): Promise<Entry[]> => {
  if (!userId) return [];
  
  console.log('Fetching journal entries for user:', userId);
  
  try {
    const { data, error } = await supabase
      .from('journal_entries')
      .select(`
        *,
        journal_photos (
          id,
          file_path,
          file_name
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    console.log('Raw journal entries from database:', data?.length || 0);

    if (error) throw error;

    console.log('Raw database entries:', data?.map(entry => ({
      id: entry.id,
      entry_date: entry.entry_date,
      source: entry.source,
      created_at: entry.created_at
    })));

    // Transform data to match Entry interface and decrypt content
    const processedEntries = await Promise.all(data.map(async (entry): Promise<Entry | null> => {
      try {
        console.log(`Processing entry ${entry.id} from ${entry.entry_date}`);
        const decryptedContent = await decrypt(entry.content, userId);
        const decryptedTitle = await decrypt(entry.title, userId);
        
        const processedEntry = {
          id: entry.id,
          content: decryptedContent,
          title: decryptedTitle,
          source: entry.source as 'web' | 'sms',
          timestamp: new Date(entry.created_at),
          entry_date: entry.entry_date,
          user_id: entry.user_id,
          tags: entry.tags || [],
          photos: entry.journal_photos?.map((photo: any) => {
            const { data: publicUrl } = supabase.storage
              .from('journal-photos')
              .getPublicUrl(photo.file_path);
            return publicUrl.publicUrl;
          }) || []
        };
        
        console.log(`Successfully processed entry ${entry.id}:`, {
          entry_date: processedEntry.entry_date,
          title: processedEntry.title.substring(0, 50) + '...',
          content_length: processedEntry.content.length
        });
        
        return processedEntry;
      } catch (error) {
        console.error(`Error processing entry ${entry.id}:`, error);
        // Return entry with original content if decryption fails
        const fallbackEntry = {
          id: entry.id,
          content: entry.content,
          title: entry.title,
          source: entry.source as 'web' | 'sms',
          timestamp: new Date(entry.created_at),
          entry_date: entry.entry_date,
          user_id: entry.user_id,
          tags: entry.tags || [],
          photos: entry.journal_photos?.map((photo: any) => {
            const { data: publicUrl } = supabase.storage
              .from('journal-photos')
              .getPublicUrl(photo.file_path);
            return publicUrl.publicUrl;
          }) || []
        };
        
        console.log(`Using fallback for entry ${entry.id}`);
        return fallbackEntry;
      }
    }));

    // Filter out any null entries and log final result
    const validEntries = processedEntries.filter((entry): entry is Entry => entry !== null);
    
    console.log('Final processed entries:', validEntries.map(entry => ({
      id: entry.id,
      entry_date: entry.entry_date,
      source: entry.source
    })));
    
    return validEntries;
  } catch (error) {
    console.error('Error fetching entries:', error);
    throw error;
  }
};

export const createJournalEntry = async ({ 
  content, 
  title, 
  tags = [], 
  photos = [], 
  userId 
}: {
  content: string;
  title: string;
  tags?: string[];
  photos?: File[];
  userId: string;
}) => {
  if (!userId) throw new Error('User not authenticated');

  // Validate inputs
  validateEntryContent(content);
  validatePhotos(photos);

  // Encrypt content and title before storing
  const encryptedContent = await encrypt(content.trim(), userId);
  const encryptedTitle = await encrypt(title.trim(), userId);

  // Get user's timezone to determine the correct entry date
  const { data: userProfile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', userId)
    .single();
  
  const userTimezone = userProfile?.timezone || 'UTC';
  
  // Convert current time to user's timezone to get the correct entry date
  const now = new Date();
  const userDate = new Date(now.toLocaleString("en-US", { timeZone: userTimezone }));
  const entryDate = userDate.toISOString().split('T')[0];
  const { data: entry, error } = await supabase
    .from('journal_entries')
    .insert({
      user_id: userId,
      content: encryptedContent,
      title: encryptedTitle,
      source: 'web',
      entry_date: entryDate,
      tags: validateTags(tags)
    })
    .select()
    .single();

  if (error) throw error;

  // Upload photos if any
  if (photos.length > 0) {
    await uploadPhotos(photos, entry.id, userId);
  }

  return entry;
};

export const updateJournalEntry = async ({ 
  id, 
  content, 
  tags,
  photos, 
  removedPhotos,
  userId 
}: { 
  id: string; 
  content: string; 
  tags?: string[];
  photos?: File[];
  removedPhotos?: string[];
  userId: string;
}) => {
  validateEntryContent(content);

  // Encrypt content before updating
  const encryptedContent = await encrypt(content.trim(), userId);

  // Prepare update data
  const updateData: any = { content: encryptedContent };
  if (tags !== undefined) {
    updateData.tags = validateTags(tags);
  }

  // Update the entry content and tags
  const { error } = await supabase
    .from('journal_entries')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw error;

  // Remove photos if any
  if (removedPhotos && removedPhotos.length > 0) {
    for (const photoUrl of removedPhotos) {
      try {
        // Extract file path from URL
        const url = new URL(photoUrl);
        const pathParts = url.pathname.split('/');
        const fileName = pathParts[pathParts.length - 1];
        
        // Delete from storage
        const { error: storageError } = await supabase.storage
          .from('journal-photos')
          .remove([`${userId}/${id}/${fileName}`]);
        
        if (storageError) {
          console.error('Error deleting photo from storage:', storageError);
        }
        
        // Delete from database
        const { error: dbError } = await supabase
          .from('journal_photos')
          .delete()
          .eq('entry_id', id)
          .eq('file_name', fileName);
        
        if (dbError) {
          console.error('Error deleting photo from database:', dbError);
        }
      } catch (error) {
        console.error('Error processing photo removal:', error);
      }
    }
  }

  // Upload new photos if any
  if (photos && photos.length > 0) {
    validatePhotos(photos);
    await checkPhotoLimit(id, photos);
    await uploadPhotos(photos, id, userId);
  }
};

export const deleteJournalEntry = async (entryId: string, userId: string) => {
  // First delete associated photos from storage
  await deleteEntryPhotos(entryId);

  // Delete the entry (photos will be deleted via cascade)
  const { error } = await supabase
    .from('journal_entries')
    .delete()
    .eq('id', entryId)
    .eq('user_id', userId);

  if (error) throw error;
};
