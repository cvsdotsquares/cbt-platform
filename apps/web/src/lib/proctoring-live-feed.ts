import { proctoringApi } from '@/lib/api';

export async function publishLiveFrame(
  accessToken: string,
  sessionId: string,
  thumbnail: string,
  source: 'screen' | 'camera',
): Promise<void> {
  try {
    await proctoringApi.uploadLiveFrame(accessToken, sessionId, { thumbnail, source });
  } catch {
    /* ignore transient upload errors */
  }
}
