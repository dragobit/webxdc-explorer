import { useParams } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';

const WebxdcDetailPage = () => {
  const { i } = useParams<{ i: string }>();

  useSeoMeta({
    title: `webxdc ${i?.slice(0, 12) ?? ''} · webxdc explorer`,
    description: 'webxdc app detail and update log.',
  });

  return (
    <div className="py-16 text-center text-muted-foreground">
      App detail — under construction
    </div>
  );
};

export default WebxdcDetailPage;
