import { useEffect, useRef, type CSSProperties } from 'react';

/**
 * Prosty edytor WYSIWYG e-maila (wyspa React) — bez zewnętrznych zależności.
 * Produkuje HTML treści; strona Svelte owija go w email-safe szkielet przed
 * kopiowaniem/wysyłką. Zmienne personalizacji: {{firma}}, {{kontakt}}, {{miasto}},
 * {{nip}} oraz wbudowana {{{UNSUBSCRIBE_URL}}}.
 *
 * To punkt startowy wewnątrz wyspy React — można tu później podmienić bardziej
 * rozbudowany edytor (np. easy-email) bez ruszania integracji ze Svelte.
 */

type Props = {
	initialHtml?: string;
	onChange?: (html: string) => void;
};

const MERGE_TAGS: Array<{ label: string; tag: string }> = [
	{ label: 'Firma', tag: '{{firma}}' },
	{ label: 'Kontakt', tag: '{{kontakt}}' },
	{ label: 'Miasto', tag: '{{miasto}}' },
	{ label: 'NIP', tag: '{{nip}}' },
	{ label: 'Link wypisu', tag: '{{{UNSUBSCRIBE_URL}}}' }
];

const toolbarStyle: CSSProperties = {
	display: 'flex',
	flexWrap: 'wrap',
	gap: 6,
	padding: 8,
	border: '1px solid #e2e8f0',
	borderBottom: 'none',
	borderRadius: '8px 8px 0 0',
	background: '#f8fafc'
};

const btnStyle: CSSProperties = {
	padding: '4px 10px',
	border: '1px solid #e2e8f0',
	borderRadius: 6,
	background: '#fff',
	color: '#0f172a',
	fontSize: 13,
	fontWeight: 600,
	cursor: 'pointer',
	lineHeight: 1.4
};

const editorStyle: CSSProperties = {
	minHeight: 320,
	padding: 16,
	border: '1px solid #e2e8f0',
	borderRadius: '0 0 8px 8px',
	background: '#fff',
	color: '#0f172a',
	fontFamily: 'Arial, Helvetica, sans-serif',
	fontSize: 15,
	lineHeight: 1.6,
	outline: 'none'
};

export default function EmailEditor({ initialHtml = '', onChange }: Props) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (ref.current && initialHtml) ref.current.innerHTML = initialHtml;
		// Ustawiamy treść startową tylko przy montażu.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	function emit() {
		onChange?.(ref.current?.innerHTML ?? '');
	}

	function exec(command: string, value?: string) {
		ref.current?.focus();
		document.execCommand(command, false, value);
		emit();
	}

	function insertText(text: string) {
		ref.current?.focus();
		document.execCommand('insertText', false, text);
		emit();
	}

	function addLink() {
		const url = window.prompt('Adres URL linku:', 'https://');
		if (url) exec('createLink', url);
	}

	return (
		<div>
			<div style={toolbarStyle}>
				<button type="button" style={{ ...btnStyle, fontWeight: 800 }} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>B</button>
				<button type="button" style={{ ...btnStyle, fontStyle: 'italic' }} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>I</button>
				<button type="button" style={{ ...btnStyle, textDecoration: 'underline' }} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}>U</button>
				<button type="button" style={btnStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', 'H2')}>Nagłówek</button>
				<button type="button" style={btnStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('formatBlock', 'P')}>Akapit</button>
				<button type="button" style={btnStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')}>• Lista</button>
				<button type="button" style={btnStyle} onMouseDown={(e) => e.preventDefault()} onClick={addLink}>Link</button>
				<button type="button" style={btnStyle} onMouseDown={(e) => e.preventDefault()} onClick={() => exec('removeFormat')}>Wyczyść</button>

				<span style={{ width: 1, background: '#e2e8f0', margin: '0 2px' }} />

				{MERGE_TAGS.map((m) => (
					<button
						key={m.tag}
						type="button"
						title={`Wstaw ${m.tag}`}
						style={{ ...btnStyle, background: '#eef2ff', borderColor: '#c7d2fe', color: '#3730a3' }}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => insertText(m.tag)}
					>
						{m.label}
					</button>
				))}
			</div>

			<div
				ref={ref}
				contentEditable
				suppressContentEditableWarning
				style={editorStyle}
				onInput={emit}
				onBlur={emit}
			/>
		</div>
	);
}
