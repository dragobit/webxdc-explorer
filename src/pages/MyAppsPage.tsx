import { useSeoMeta } from '@unhead/react';

const MyAppsPage = () => {
  useSeoMeta({
    title: 'My Apps · webxdc explorer',
    description: 'webxdc apps you have used on Nostr.',
  });

  return (
    <div className="py-16 text-center text-muted-foreground">
      My Apps — under construction
    </div>
  );
};

export default MyAppsPage;
