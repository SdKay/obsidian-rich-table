import type { ChoiceOption, ChoiceType } from './model';

const BUILTIN_CHOICES: ChoiceType[] = [
	{
		id: 'task-status',
		options: [
			{ value: 'none',        label: 'None',        color: '#A1A1AA' },
			{ value: 'todo',        label: 'Todo',        color: '#A78BFA' },
			{ value: 'pending',     label: 'Pending',     color: '#FDE047' },
			{ value: 'in-progress', label: 'In Progress', color: '#38BDF8' },
			{ value: 'done',        label: 'Done',        color: '#34D399' },
			{ value: 'cancel',      label: 'Cancel',      color: '#FF6B81' },
		],
	},
	{
		id: 'priority',
		options: [
			{ value: 'high',   label: 'High',   color: 'rgba(239,68,68,0.2)'  },
			{ value: 'medium', label: 'Medium', color: 'rgba(249,115,22,0.2)' },
			{ value: 'low',    label: 'Low',    color: 'rgba(59,130,246,0.2)' },
		],
	},
	{
		id: 'boolean',
		options: [
			{ value: 'yes', label: 'Yes', color: 'rgba(34,197,94,0.25)'  },
			{ value: 'no',  label: 'No',  color: 'rgba(239,68,68,0.20)'  },
		],
	},
	{
		id: 'rating',
		options: [
			{ value: '1', label: '★',     color: 'rgba(234,179,8,0.10)' },
			{ value: '2', label: '★★',    color: 'rgba(234,179,8,0.15)' },
			{ value: '3', label: '★★★',   color: 'rgba(234,179,8,0.20)' },
			{ value: '4', label: '★★★★',  color: 'rgba(234,179,8,0.25)' },
			{ value: '5', label: '★★★★★', color: 'rgba(234,179,8,0.30)' },
		],
	},
	{
		id: 'effort',
		options: [
			{ value: 'xs', label: 'XS', color: 'rgba(34,197,94,0.20)'  },
			{ value: 's',  label: 'S',  color: 'rgba(34,197,94,0.15)'  },
			{ value: 'm',  label: 'M',  color: 'rgba(234,179,8,0.20)'  },
			{ value: 'l',  label: 'L',  color: 'rgba(249,115,22,0.20)' },
			{ value: 'xl', label: 'XL', color: 'rgba(239,68,68,0.20)'  },
		],
	},
	{
		id: 'approval',
		options: [
			{ value: 'approved', label: 'Approved', color: 'rgba(34,197,94,0.25)'  },
			{ value: 'pending',  label: 'Pending',  color: 'rgba(234,179,8,0.20)'  },
			{ value: 'rejected', label: 'Rejected', color: 'rgba(239,68,68,0.20)'  },
		],
	},
];

export class ChoiceRegistry {
	private readonly types = new Map<string, ChoiceType>();

	constructor(custom: ChoiceType[] = []) {
		for (const t of BUILTIN_CHOICES) this.types.set(t.id, t);
		for (const t of custom) this.types.set(t.id, t);
	}

	get(id: string): ChoiceType | undefined {
		return this.types.get(id);
	}

	getOption(typeId: string, value: string): ChoiceOption | undefined {
		return this.types.get(typeId)?.options.find(o => o.value === value.trim());
	}

	getAllTypes(): ChoiceType[] {
		return Array.from(this.types.values());
	}

	getBuiltinIds(): Set<string> {
		return new Set(BUILTIN_CHOICES.map(t => t.id));
	}
}
