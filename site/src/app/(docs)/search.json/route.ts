import { searchData } from '@/lib/docs';

export const dynamic = 'force-static';

export function GET() {
  return Response.json(searchData());
}
