import { ownerContentItem, ownerContentUnanswered } from '@rede-social/module-dashboard/fixtures';
import { CountUp, LIFT, RISE, SURFACE } from '@rede-social/module-dashboard/ui';
import { Card, cn } from '@rede-social/ui';
import { AlertTriangle } from 'lucide-react';
import {
  contentBackHref,
  contentTabView,
  type OwnerContentView,
  ownerContentHref,
} from '@/lib/owner-content-view';
import { BackLink } from './BackLink';
import { CardLink } from './CardLink';
import { CoverThumb } from './CoverThumb';
import { type DashboardT, momentText } from './format';
import { contentAgeText, contentMeta, LinkArrow } from './OwnerContentPostCard';
import { SPAN_ALL } from './ownerGrid';
import { DisabledAction, PanelSection } from './PanelSection';

const KEY = 'tenantOwner.content';

/**
 * The comments of one "Precisa de atenção" post the team has not answered (quick 261013-orf E-02):
 * "Voltar" to its row, the publication (thumbnail, caption, meta: one card linking to its detail,
 * quick 261013-uoi F-7), the overview row's own count line, then each comment as a card, oldest
 * first — who wrote it, their band, the text, when, and "Responder" (disabled, as every sample
 * action). It reads across the whole area: the comments in columns on the web. The only web file
 * that reads `ownerContentUnanswered`: by the user's decision E-02 it shows the text of the
 * unanswered comments, to the client's team only.
 */
export function OwnerContentReplies({ t, view }: { t: DashboardT; view: OwnerContentView }) {
  const back = contentBackHref(view);
  // The parser only sets `reply` for a post that needs attention: a gap here is a bug.
  if (!view.reply || back === null) throw new Error('an unanswered comments screen with no post');
  const item = ownerContentItem(view.reply);
  const comments = ownerContentUnanswered(item.id);
  const hours = item.commentMeta.oldestUnansweredHours ?? 0;

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', SPAN_ALL)}>
      <BackLink href={back} label={t('tenantOwner.memberDetail.back')} />
      <PanelSection title={t(`${KEY}.replies.title`)} prominent>
        <CardLink href={ownerContentHref({ ...contentTabView('overview'), postId: item.id })}>
          <Card className={cn(SURFACE, RISE, LIFT, 'flex items-start gap-3 p-3')}>
            <CoverThumb
              t={t}
              kind={item.kind}
              seed={item.id}
              durationSeconds={item.durationSeconds}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere]">
              <span className="text-sm font-bold text-text">{item.excerpt}</span>
              <span className="text-xs text-text-secondary">{contentMeta(t, item)}</span>
            </span>
            <LinkArrow label={t('tenantOwner.seeDetail')} />
          </Card>
        </CardLink>
        <p className="flex items-start gap-1.5 text-sm font-semibold text-warning">
          <AlertTriangle aria-hidden size={16} className="mt-0.5 shrink-0" />
          <CountUp
            value={t(`${KEY}.overview.attention.row`, {
              count: item.comments - item.commentMeta.answered,
              age: contentAgeText(t, hours),
            })}
          />
        </p>
        <ul data-dash-stagger className="grid gap-3 @4xl:grid-cols-2 @min-[100rem]:grid-cols-3">
          {comments.map(({ person, text }) => (
            <li key={person.id} className="min-w-0">
              <Card className={cn(SURFACE, RISE, 'flex h-full flex-col gap-2 p-4')}>
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm [overflow-wrap:anywhere]">
                  <span className="font-bold text-text">{person.name}</span>
                  <span className="text-xs text-text-secondary">
                    {t(`tenantOwner.memberDetail.band.${person.band}`)}
                  </span>
                </p>
                <p className="text-sm text-text [overflow-wrap:anywhere]">{text}</p>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-text-secondary">
                    {t(`${KEY}.replies.when`, { when: momentText(t, person.when) })}
                  </span>
                  <DisabledAction variant="outline">{t(`${KEY}.replies.reply`)}</DisabledAction>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </PanelSection>
    </div>
  );
}
