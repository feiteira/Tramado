// New class (UX §3.3.1), registry dialog `new-class` (`[class-dialog]`).
import React from 'react';
import type { AppServices } from '../../services/types/common';
import type { DialogPropsMap } from '../registry';
import { ClassDialog } from './ClassDialog';

export default function NewClassDialog({ props, services, close }: { props: DialogPropsMap['new-class']; services: AppServices; close(): void }) {
  void props;
  return <ClassDialog services={services} classId={null} close={close} />;
}
