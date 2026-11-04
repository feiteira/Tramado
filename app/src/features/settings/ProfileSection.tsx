// Settings › Profile (UX §3.14.1): your name (saved on blur, written to every class's member file), this computer's
// name, your colour (avatar initials preview), and what classmates see.
import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { AppServices } from '../../services/types/common';
import { useAppState } from '../../shell/AppState';
import { useStore } from '../../shell/useStore';
import { ColorPicker } from '../../ui/components/ColorPicker';
import { TextField } from '../../ui/components/Field';
import { useToast } from '../../ui/components/Toast';
import { Avatar } from '../../ui/tramado/Avatar';
import { memberColour } from '../../ui/classColor';
import { useI18n } from '../../ui/i18n';
import { Group, Row, SectionRoot } from './Group';

export default function ProfileSection({ services }: { services: AppServices }) {
  const { t } = useI18n();
  const app = useAppState();
  const toast = useToast();
  const me = useStore(services.ctx.identity);
  const [name, setName] = useState(me?.name ?? '');
  const [device, setDevice] = useState(me?.deviceName ?? '');
  useEffect(() => setName(me?.name ?? ''), [me?.name]);
  useEffect(() => setDevice(me?.deviceName ?? ''), [me?.deviceName]);
  const save = async (patch: { name?: string; deviceName?: string; colour?: string | null }) => {
    try {
      await app.updateIdentity(patch);
      toast.show({ message: t('common.saved'), tone: 'success', durationMs: 2500 });
    } catch (e) {
      toast.error(e);
    }
  };
  const colour = me ? memberColour(me.memberId, me.colour) : null;
  return (
    <SectionRoot testid="settings-profile" title={t('settings.sections.profile')}>
      <Group id="profile">
        <Row label={t('settings.profile.name')} hint={t('settings.profile.nameHint')} labelId="profile-name-label">
          <TextField
            aria-labelledby="profile-name-label"
            value={name}
            onChange={(v) => setName(v.slice(0, 64))}
            onBlur={() => {
              const v = name.trim();
              if (v && v !== me?.name) void save({ name: v });
              else if (!v) setName(me?.name ?? '');
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            maxLength={64}
            data-testid="profile-name"
          />
        </Row>
        <Row label={t('settings.profile.device')} labelId="profile-device-label">
          <TextField
            aria-labelledby="profile-device-label"
            value={device}
            onChange={(v) => setDevice(v.slice(0, 64))}
            onBlur={() => {
              const v = device.trim();
              if (v && v !== me?.deviceName) void save({ deviceName: v });
              else if (!v) setDevice(me?.deviceName ?? '');
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            maxLength={64}
            data-testid="profile-device"
          />
        </Row>
        <Row label={t('settings.profile.colour')} stack>
          <div className="profile-colour">
            {me ? <Avatar name={me.name} memberId={me.memberId} colour={colour ?? undefined} size={40} data-testid="profile-avatar" /> : null}
            <ColorPicker label={t('settings.profile.colour')} value={colour} onChange={(hex) => void save({ colour: hex })} data-testid="profile-colour" />
          </div>
        </Row>
      </Group>
      <p className="set-note">
        <ShieldCheck size={16} strokeWidth={1.75} aria-hidden />
        {t('settings.profile.info')}
      </p>
    </SectionRoot>
  );
}
