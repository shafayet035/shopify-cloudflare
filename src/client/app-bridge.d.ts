/**
 * @shopify/app-bridge-types augments the *global* JSX namespace, which React 19
 * no longer reads (it uses React.JSX). Declare the App Bridge web components we
 * use here instead.
 */
import "react";

declare module "react" {
	namespace JSX {
		interface IntrinsicElements {
			"ui-nav-menu": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
			"ui-title-bar": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
				title?: string;
			};
		}
	}
}
